/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFulfillmentAvailability, resolveFulfillmentSelection, type CardapioFulfillment } from "../fulfillment";
import { getEffectiveProductPrice } from "../../domain/productMerchandising";
import { OrderItemComposition } from "../../components/shared/OrderItemComposition";
import { cardapioCompositionSource } from "../orderItems";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Banknote,
  Bike,
  Check,
  CheckCircle2,
  ChevronDown,
  Coins,
  CreditCard,
  MapPin,
  Mail,
  Minus,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Ticket,
  Trash2,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  KomaAccountInviteAsset,
  KomaBagAsset,
  KomaDeliveryAsset,
  KomaDineInAsset,
  KomaPickupAsset,
} from "../v2/KomaVisualAssets";
import { formatBrazilianPhone, normalizeBrazilianPhone } from "../customerSession";
import { isValidCpf, isValidCnpj } from "../../legal/taxId";
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
  updateDeliveryAddressGeographicField,
} from "../../domain/deliveryAddress";
import DeliveryAddressFields from "../../components/shared/DeliveryAddressFields";
import { getDeliveryMinimumRemaining, getDeliveryQuote } from "../deliveryPresentation";
import CardapioPaymentOptions from "./CardapioPaymentOptions";
import { getCheckoutPaymentMethods, getPaymentSelectionError, resolvePaymentSelection, type PaymentMethod } from "../paymentMethods";
import { getPairingRecommendations, classifyProduct } from "../pairingRecommendations";
import { resolvePairingDisplay } from "../resolvePairingDisplay";
import { isGroupedProduct } from "../catalogGrouping";
import { inspectCartAgainstLiveCatalog } from "../cartCatalogConsistency";
import { KomaPrimaryAction } from "./KomaActionPrimitives";

/** PagBank Order requires a valid payer email of at least 6 characters; this checkout caps input at 254. */
export function isValidPixPayerEmail(value: string): boolean {
  const email = value.trim();
  return email.length >= 6 && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  selectedOptions: Record<string, ProductOption[]>;
  notes: string;
  promotionId?: string;
  promotionParts?: import('../promotionComposition').PromotionPartSelection[];
}

export type { CardapioFulfillment } from "../fulfillment";

export interface CardapioCheckoutRequest {
  deliveryMethod: CardapioFulfillment;
  address: string;
  addressSnapshot?: DeliveryAddressSnapshot;
  deliveryFee: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerDocument?: string;
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
  initialFulfillment?: CardapioFulfillment | null;
  onFulfillmentChange?: (method: CardapioFulfillment) => void;
  allProducts?: Product[];
  onClose: () => void;
  onUpdateQty: (itemId: string, newQty: number) => void;
  onAdjustQty?: (itemId: string, delta: number) => void;
  onRemoveItem: (itemId: string) => void;
  onEditItem?: (item: CartItem) => void;
  onComposeAnother?: (item: CartItem) => void;
  onAddToCart?: (product: Product, quantity: number, options?: Record<string, ProductOption[]>, notes?: string) => void;
  onSelectProduct?: (product: Product) => void;
  initialCouponCode?: string;
  onPlaceOrder: (orderData: CardapioCheckoutRequest) => void;
  user: any;
  customerToken?: string | null;
  accountRequired?: boolean;
  onAuthClick?: () => void;
  orderingEnabled?: boolean;
  orderingMessage?: string;
  draftRestoreIssues?: string[];
  onDismissDraftRestoreIssues?: () => void;
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
  initialFulfillment,
  onFulfillmentChange,
  allProducts = [],
  onClose,
  onUpdateQty,
  onAdjustQty,
  onRemoveItem,
  onEditItem,
  onComposeAnother,
  onAddToCart,
  onSelectProduct,
  initialCouponCode = "",
  onPlaceOrder,
  user,
  customerToken = null,
  accountRequired = false,
  onAuthClick,
  orderingEnabled = true,
  orderingMessage = "Pedidos temporariamente pausados.",
  draftRestoreIssues = [],
  onDismissDraftRestoreIssues,
}: CardapioCartDrawerProps) {
  const [selectedFulfillment, setSelectedFulfillment] = useState<CardapioFulfillment | null>(initialFulfillment ?? null);
  useEffect(() => {
    if (initialFulfillment && selectedFulfillment === null) {
      setSelectedFulfillment(initialFulfillment);
    }
  }, [initialFulfillment, selectedFulfillment]);
  const deliveryMethod = resolveFulfillmentSelection(brandConfig, selectedFulfillment);
  const { pickup: pickupEnabled, dine_in: dineInEnabled, delivery: deliveryEnabled } = getFulfillmentAvailability(brandConfig);
  const setDeliveryMethod = (method: CardapioFulfillment) => {
    setSelectedFulfillment(method);
    onFulfillmentChange?.(method);
  };
  const hasPromotion = cart.some(item => Boolean(item.promotionId));
  const couponsEnabled = !hasPromotion && brandConfig?.benefits?.coupons === true;
  const cashbackEnabled = !hasPromotion && brandConfig?.benefits?.cashback === true;
  const showDiscounts = couponsEnabled || cashbackEnabled;
  const initialGuestContact = useMemo(() => {
    if (user) return null;
    try {
      return loadGuestCheckoutContact(restaurantId);
    } catch {
      return null;
    }
  // Leitura síncrona somente para hidratar o primeiro render sem sobrescrever sessionStorage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [address, setAddress] = useState(user?.address || initialGuestContact?.address || "");
  const [deliveryAddressDraft, setDeliveryAddressDraft] = useState<DeliveryAddressDraft>(() => (
    parseDeliveryAddressLegacy(user?.address || initialGuestContact?.address) || emptyAddress()
  ));
  const [legacyAddressHint, setLegacyAddressHint] = useState<string | null>(() => (
    user?.address && !parseDeliveryAddressLegacy(user.address) ? user.address : null
  ));
  const [selectedBairro, setSelectedBairro] = useState(() => deliveryAddressDraft.bairro);
  const [isBairroPickerOpen, setIsBairroPickerOpen] = useState(false);
  const [bairroSearch, setBairroSearch] = useState("");
  const trocoInputRef = useRef<HTMLInputElement | null>(null);
  const [guestName, setGuestName] = useState(() => user?.name || initialGuestContact?.name || "");
  const [guestPhone, setGuestPhone] = useState(() => formatBrazilianPhone(user?.phone || initialGuestContact?.phone || ""));
  const [guestEmail, setGuestEmail] = useState(() => user?.email || initialGuestContact?.email || "");
  const [hydratedGuestRestaurantId, setHydratedGuestRestaurantId] = useState<string | null>(() => (
    user ? null : String(restaurantId)
  ));
  const [guestDocument, setGuestDocument] = useState("");
  const [customerRecognition, setCustomerRecognition] = useState<CustomerRecognitionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const [activeSection, setActiveSection] = useState("cart-items");

  const clearValidation = (fieldId?: string) => {
    if (!fieldId || invalidField === fieldId) setInvalidField("");
    if (errorMessage) setErrorMessage("");
  };

  const reportValidationError = (message: string, fieldId?: string) => {
    setErrorMessage(message);
    setInvalidField(fieldId || "");
    if (!fieldId) return;
    const section = document.getElementById(fieldId)?.closest("section[id]");
    if (section?.id) setActiveSection(section.id);
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
  const [couponCode, setCouponCode] = useState(initialCouponCode);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    codigo: string;
    desconto: number;
    mensagem: string;
  } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [pendingCouponAfterPhone, setPendingCouponAfterPhone] = useState(false);

  useEffect(() => {
    if (!initialCouponCode.trim()) return;
    setCouponCode(initialCouponCode);
    setAppliedCoupon(null);
    appliedCouponFingerprintRef.current = null;
    setCouponError("");
    setPendingCouponAfterPhone(false);
  }, [initialCouponCode]);

  // Cashback state
  const [useCashback, setUseCashback] = useState(false);

  useEffect(() => {
    setAppliedCoupon(null);
    appliedCouponFingerprintRef.current = null;
    setUseCashback(false);
    setCouponError("");
    setPendingCouponAfterPhone(false);
  }, [restaurantId, couponsEnabled, cashbackEnabled]);

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
      setHydratedGuestRestaurantId(null);
      setGuestName(user.name || "");
      setGuestPhone(formatBrazilianPhone(user.phone || ""));
      setGuestEmail(user.email || "");
      applyStoredAddress(user.address || "");
      return;
    }

    let parsed = null;
    try {
      parsed = loadGuestCheckoutContact(restaurantId);
    } catch {
      parsed = null;
    }
    if (parsed) {
      setGuestName(parsed.name);
      setGuestPhone(formatBrazilianPhone(parsed.phone));
      setGuestEmail(parsed.email);
      applyStoredAddress(parsed.address || "");
    } else {
      setGuestName("");
      setGuestPhone("");
      setGuestEmail("");
    }
    setHydratedGuestRestaurantId(String(restaurantId));
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
    if (user || hydratedGuestRestaurantId !== String(restaurantId)) return;
    try {
      const contact = {
        name: guestName.trim(),
        phone: normalizeBrazilianPhone(guestPhone),
        email: guestEmail.trim().toLowerCase(),
        address: address.trim(),
      };
      saveGuestCheckoutContact(restaurantId, contact);
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }, [address, guestEmail, guestName, guestPhone, hydratedGuestRestaurantId, restaurantId, user]);

  // Subtotal calculation
  const subtotal = useMemo(() => cart.reduce((acc, item) => {
    let itemPrice = getEffectiveProductPrice(item.product.price, item.product.promotionalPrice).effectivePrice;
    Object.values(item.selectedOptions).forEach((opts) => {
      opts.forEach((option) => {
        itemPrice += option.extraPrice;
      });
    });
    return acc + itemPrice * item.quantity;
  }, 0), [cart]);

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartCatalogDrift = useMemo(
    () => inspectCartAgainstLiveCatalog(cart, allProducts, brandConfig?.promotions, brandConfig?.promotionProducts),
    [allProducts, brandConfig?.promotionProducts, brandConfig?.promotions, cart],
  );
  const couponValidationFingerprint = `${restaurantId}:${couponsEnabled}:${subtotal.toFixed(2)}:${normalizeBrazilianPhone(user?.phone || guestPhone)}:${couponCode.trim().toUpperCase()}`;
  const couponFingerprintRef = useRef(couponValidationFingerprint);
  const appliedCouponFingerprintRef = useRef<string | null>(null);
  couponFingerprintRef.current = couponValidationFingerprint;

  useEffect(() => {
    if (appliedCoupon && appliedCouponFingerprintRef.current !== couponValidationFingerprint) {
      setAppliedCoupon(null);
      setCouponError("O pedido, celular ou cupom mudou. Confira o cupom novamente.");
    }
  }, [appliedCoupon, couponValidationFingerprint]);

  const deliveryQuote = getDeliveryQuote(brandConfig, subtotal, selectedBairro);
  const deliveryFee = deliveryMethod === "delivery" ? deliveryQuote.fee : 0;
  const minimumOrder = brandConfig?.pedidoMinimo || 0;
  const remainingMinimum = deliveryMethod ? getDeliveryMinimumRemaining(brandConfig, subtotal, deliveryMethod) : 0;
  const freeDeliveryThreshold = brandConfig?.freteGratisValor || 0;
  const neighborhoodFees = useMemo(() => brandConfig?.tabelaTaxasBairros || [], [brandConfig?.tabelaTaxasBairros]);
  const filteredNeighborhoods = useMemo(() => {
    const query = bairroSearch.trim().toLowerCase();
    if (!query) return neighborhoodFees;
    return neighborhoodFees.filter((item) => item.bairro.toLowerCase().includes(query));
  }, [bairroSearch, neighborhoodFees]);
  const selectedNeighborhoodItem = useMemo(
    () => neighborhoodFees.find((item) => item.bairro.trim().toLowerCase() === selectedBairro.trim().toLowerCase()) || null,
    [neighborhoodFees, selectedBairro],
  );

  useEffect(() => {
    if (brandConfig && selectedFulfillment && selectedFulfillment !== deliveryMethod) {
      setSelectedBairro("");
    }
  }, [brandConfig, selectedFulfillment, deliveryMethod]);

  // Cashback deduction calculation
  const userCashbackBalance = cashbackEnabled ? Number(user?.cashback ?? user?.saldo_cashback ?? 0) : 0;
  const cashbackDiscount = useMemo(() => {
    if (!useCashback || userCashbackBalance <= 0) return 0;
    // Cap at subtotal - coupon discount
    const availableTotal = Math.max(0, subtotal - (couponsEnabled ? appliedCoupon?.desconto || 0 : 0));
    return Math.min(userCashbackBalance, availableTotal);
  }, [useCashback, userCashbackBalance, subtotal, appliedCoupon, couponsEnabled]);

  // Total calculation
  const couponDiscount = couponsEnabled ? appliedCoupon?.desconto || 0 : 0;
  const total = Math.max(0, subtotal + deliveryFee - couponDiscount - cashbackDiscount);

  // Troco calculation
  const trocoValorNum = parseFloat(trocoPara) || 0;
  const trocoCalculado = precisaTroco && trocoValorNum > total ? trocoValorNum - total : 0;

  // Upselling suggestions usando motor determinístico de recomendações complementares
  const upsellSuggestions = useMemo(() => {
    if (!allProducts || allProducts.length === 0) return [];
    const cartProductIds = cart.map((item) => item.product.id);
    const manualIds = brandConfig?.cartRecommendationSkuIds;
    const candidates = manualIds?.length
      ? manualIds.map((skuId) => allProducts.find((product) => String(product.id) === skuId))
        .filter((product): product is Product => Boolean(product && product.isAvailable !== false))
      : getPairingRecommendations({
          catalog: allProducts,
          cartProductIds,
          limit: 12,
          excludeCartItems: false,
        });
    // The cart and artistic showcase must use the same family card and real SKUs.
    return resolvePairingDisplay(allProducts, candidates, restaurantId, 4)
      .filter((item) => item.isAvailable !== false);
  }, [allProducts, cart, restaurantId, brandConfig?.cartRecommendationSkuIds]);

  const emptyCartSuggestions = useMemo(() => {
    const manualIds = brandConfig?.cartRecommendationSkuIds;
    const candidates = manualIds?.length
      ? manualIds.map((skuId) => allProducts.find((product) => String(product.id) === skuId))
        .filter((product): product is Product => Boolean(product && product.isAvailable !== false))
      : allProducts.filter((product) => product.isAvailable !== false);
    return resolvePairingDisplay(allProducts, candidates, restaurantId, 3)
      .filter((item) => item.isAvailable !== false);
  }, [allProducts, restaurantId, brandConfig?.cartRecommendationSkuIds]);

  const upsellHeading = useMemo(() => {
    const types = new Set(upsellSuggestions.map(classifyProduct));
    if (types.has("beverage") && (types.has("dessert") || types.has("side"))) {
      return "Bebida ou acompanhamento para sua refeição?";
    }
    if (types.has("beverage") && types.has("dessert")) {
      return "Uma bebida ou sobremesa para acompanhar?";
    }
    if (types.has("beverage")) {
      return "Uma bebida bem gelada para acompanhar?";
    }
    if (types.has("dessert")) {
      return "Uma sobremesa artesanal para finalizar?";
    }
    if (types.has("side")) {
      return "Um acompanhamento para seu pedido?";
    }
    return "Combina com seu pedido";
  }, [upsellSuggestions]);

  // Handle Coupon Validation
  const handleApplyCoupon = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!couponsEnabled || !couponCode.trim()) return;
    if (!user && !isCompleteBrazilianPhone(guestPhone)) {
      setPendingCouponAfterPhone(true);
      reportValidationError("Informe seu celular em Contato para conferir este cupom.", "input-guest-phone");
      return;
    }

    setValidatingCoupon(true);
    setCouponError("");
    const requestFingerprint = couponValidationFingerprint;
    try {
      const res = await fetch(`${API_BASE_URL}/cardapio/cupons/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: Number(restaurantId),
          codigo: couponCode.trim().toUpperCase(),
          subtotal,
          telefone: normalizeBrazilianPhone(user?.phone || guestPhone),
        }),
      });

      const data = await res.json().catch(() => null) as {
        valido?: boolean;
        codigo?: string;
        desconto_calculado?: number;
        mensagem?: string;
        detail?: unknown;
      } | null;
      if (couponFingerprintRef.current !== requestFingerprint) {
        setCouponError("O pedido, celular ou cupom mudou. Confira o cupom novamente.");
        return;
      }
      if (!res.ok || !data?.valido) {
        const detail = typeof data?.detail === "string" ? data.detail.trim() : "";
        const message = (typeof data?.mensagem === "string" && data.mensagem.trim())
          || detail
          || (res.ok ? "Cupom inválido." : "Erro ao validar cupom. Tente novamente.");
        setCouponError(message);
        setAppliedCoupon(null);
      } else {
        appliedCouponFingerprintRef.current = requestFingerprint;
        setAppliedCoupon({
          codigo: data.codigo || couponCode.trim().toUpperCase(),
          desconto: data.desconto_calculado || 0,
          mensagem: data.mensagem || "Cupom aplicado com sucesso!",
        });
        setPendingCouponAfterPhone(false);
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
    appliedCouponFingerprintRef.current = null;
    setCouponCode("");
    setCouponError("");
    setPendingCouponAfterPhone(false);
  };

  const recognizedExistingCustomer = !user && customerRecognition === "found";
  const customerName = user?.name || (recognizedExistingCustomer ? "Cliente identificado" : guestName);
  const customerPhone = user?.phone || normalizeBrazilianPhone(guestPhone);

  interface CartStepDefinition {
    id: string;
    label: string;
    accessibleName?: string;
    fullTitle: string;
    sectionId: string;
    icon: React.ComponentType<{ className?: string }>;
  }

  const visibleSteps = useMemo(() => {
    const rawSteps: CartStepDefinition[] = [
      { id: "items", label: "Itens", fullTitle: "Seu pedido", sectionId: "cart-items", icon: ShoppingBag },
      { id: "delivery", label: "Receber", fullTitle: "Como quer receber?", sectionId: "cart-receive-methods", icon: Bike },
      ...(showDiscounts ? [{ id: "discounts", label: "Descontos", accessibleName: "Descontos", fullTitle: "Descontos & Benefícios", sectionId: "cart-discounts", icon: Ticket }] : []),
      { id: "payment", label: "Pagamento", accessibleName: "Pagamento", fullTitle: "Como quer pagar?", sectionId: "cart-payment-methods", icon: CreditCard },
      { id: "contact", label: "Contato", accessibleName: "Contato", fullTitle: "Seu contato", sectionId: "cart-identification", icon: UserCheck },
    ];

    return rawSteps.map((step, index) => ({
      ...step,
      stepNumber: index + 1,
      chipLabel: `${index + 1}. ${step.label}`,
      headingLabel: `${index + 1}. ${step.fullTitle}`,
    }));
  }, [showDiscounts]);

  const currentStepIndex = visibleSteps.findIndex((s) => s.sectionId === activeSection);
  const nextStep = currentStepIndex >= 0 && currentStepIndex < visibleSteps.length - 1 ? visibleSteps[currentStepIndex + 1] : null;
  const nextSection = nextStep ? nextStep.sectionId : null;

  const stepStatusMap = useMemo<Record<string, "done" | "pending" | "optional">>(() => {
    const itemsDone = cart.length > 0 && cartCatalogDrift.size === 0;
    const deliveryDone = Boolean(deliveryMethod)
      && remainingMinimum <= 0
      && (deliveryMethod !== "delivery" || Boolean(deliveryAddressDraftToSnapshot(deliveryAddressDraft)));
    const discountsDone = Boolean(appliedCoupon || (useCashback && cashbackDiscount > 0));
    const paymentDone = Boolean(paymentDetail)
      && !paymentError
      && !(paymentDetail === "dinheiro" && precisaTroco && (!trocoPara.trim() || !Number.isFinite(Number(trocoPara)) || trocoValorNum <= 0 || trocoValorNum < total));
    const pixDocPending = paymentDetail === "pix"
      && Boolean(brandConfig?.pixPayerDocumentRequired)
      && !(isValidCpf(guestDocument) || isValidCnpj(guestDocument));
    const pixEmailPending = paymentDetail === "pix"
      && brandConfig?.pixDirect !== true
      && (brandConfig?.pixPayerDocumentRequired
        ? !isValidPixPayerEmail(guestEmail)
        : !/^\S+@\S+\.\S+$/.test(guestEmail.trim()));
    const contactDone = Boolean(user)
      || (!accountRequired
        && (recognizedExistingCustomer || customerName.trim().length >= 2)
        && normalizeBrazilianPhone(customerPhone).length >= 10
        && !pixDocPending
        && !pixEmailPending);

    return {
      items: itemsDone ? "done" : "pending",
      delivery: deliveryDone ? "done" : "pending",
      discounts: discountsDone ? "done" : "optional",
      payment: paymentDone ? "done" : "pending",
      contact: contactDone ? "done" : "pending",
    };
  }, [
    accountRequired,
    appliedCoupon,
    brandConfig?.pixDirect,
    brandConfig?.pixPayerDocumentRequired,
    cart.length,
    cartCatalogDrift.size,
    cashbackDiscount,
    customerName,
    customerPhone,
    deliveryAddressDraft,
    deliveryMethod,
    guestDocument,
    guestEmail,
    paymentDetail,
    paymentError,
    precisaTroco,
    recognizedExistingCustomer,
    remainingMinimum,
    total,
    trocoPara,
    trocoValorNum,
    useCashback,
    user,
  ]);

  const sectionFocusFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (sectionFocusFrame.current !== null) window.cancelAnimationFrame(sectionFocusFrame.current);
  }, []);

  const jumpToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    if (sectionFocusFrame.current !== null) window.cancelAnimationFrame(sectionFocusFrame.current);
    sectionFocusFrame.current = window.requestAnimationFrame(() => {
      sectionFocusFrame.current = null;
      const target = document.getElementById(sectionId);
      // O cliente pode ter tocado em um campo antes deste frame. Não tomar
      // o foco durante a digitação nem redirecionar texto para outro elemento.
      if (!target || target.contains(document.activeElement)) return;
      // A navegação entre etapas não deve impor rolagem animada a quem pediu menos movimento.
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      target.focus({ preventScroll: true });
    });
  };

  const validateSection = (sectionId: string) => {
    if (sectionId === "cart-items" && cart.length === 0) {
      reportValidationError("Sua sacola está vazia.", "cart-items");
      return false;
    }
    if (sectionId === "cart-items" && cartCatalogDrift.size > 0) {
      const affected = Array.from(cartCatalogDrift.values()).map((entry) => entry.productName).join(", ");
      reportValidationError(
        `O cardápio mudou desde a montagem (${affected}). Atualize ou remova os itens destacados antes de continuar.`,
        "cart-items",
      );
      return false;
    }
    if (sectionId === "cart-receive-methods") {
      if (!deliveryMethod) {
        reportValidationError("Nenhuma modalidade de recebimento disponível.", "cart-receive-methods");
        return false;
      }

      // Check minimum order
      const pedidoMin = brandConfig?.pedidoMinimo || 0;
      const isDeliveryBelowMinimum = deliveryMethod === "delivery" && pedidoMin > 0 && subtotal < pedidoMin;
      const isPickupBelowMinimum = deliveryMethod === "pickup" && Boolean(brandConfig?.pedidoMinimoRetirada) && pedidoMin > 0 && subtotal < pedidoMin;
      if (isDeliveryBelowMinimum || isPickupBelowMinimum) {
        const modeLabel = deliveryMethod === "delivery" ? "para entrega" : "para retirada";
        reportValidationError(`O pedido mínimo ${modeLabel} é de ${formatPrice(pedidoMin)} (faltam ${formatPrice(pedidoMin - subtotal)}).`, "cart-receive-methods");
        return false;
      }

      if (deliveryMethod === "delivery" && !deliveryEnabled) {
        reportValidationError("O delivery está desativado para este restaurante. Escolha retirada.", "cart-receive-methods");
        return false;
      }

      const addressSnapshot = deliveryMethod === "delivery"
        ? deliveryAddressDraftToSnapshot(deliveryAddressDraft)
        : null;
      if (deliveryMethod === "delivery" && !addressSnapshot) {
        reportValidationError(
          getDeliveryAddressValidationError(deliveryAddressDraft) || "Informe o endereço completo de entrega.",
          !deliveryAddressDraft.logradouro.trim() ? "delivery-address-logradouro"
            : !deliveryAddressDraft.numero.trim() ? "delivery-address-numero"
              : deliveryAddressDraft.cep.replace(/\D/g, "").length !== 8 && deliveryAddressDraft.cep.trim() ? "delivery-address-cep"
                : "cart-receive-methods",
        );
        return false;
      }

    }
    if (sectionId === "cart-payment-methods") {
      if (paymentError || !paymentDetail) {
        reportValidationError(paymentError || "Escolha uma forma de pagamento.", "cart-payment-methods");
        return false;
      }
      if (paymentDetail === "dinheiro" && precisaTroco && (!trocoPara.trim() || !Number.isFinite(Number(trocoPara)) || trocoValorNum <= 0 || trocoValorNum < total)) {
        reportValidationError(`O valor para troco deve ser igual ou maior que o total do pedido (${formatPrice(total)}).`, "payment-change-for");
        return false;
      }

    }
    return true;
  };

  const canAdvanceTo = (targetSectionId: string): boolean => {
    const currentIndex = visibleSteps.findIndex((s) => s.sectionId === activeSection);
    const targetIndex = visibleSteps.findIndex((s) => s.sectionId === targetSectionId);
    if (targetIndex <= currentIndex) return true;

    for (let i = currentIndex; i < targetIndex; i++) {
      const step = visibleSteps[i];
      if (!validateSection(step.sectionId)) {
        return false;
      }
    }
    return true;
  };

  const navigateToStep = (targetSectionId: string) => {
    clearValidation();
    jumpToSection(targetSectionId);
  };

  const continueToSection = (sectionId: string) => {
    clearValidation();
    if (validateSection(activeSection)) jumpToSection(sectionId);
  };

  const handleSuggestedProductAction = (product: Product) => {
    if (!orderingEnabled) {
      reportValidationError(orderingMessage);
      return;
    }
    if (product.isAvailable === false) {
      reportValidationError("Este produto não está disponível no momento.");
      return;
    }
    const hasModifiers = Boolean(
      isGroupedProduct(product) ||
      (product.modifierGroups && product.modifierGroups.length > 0) ||
      (product.modifiers && product.modifiers.length > 0)
    );
    if (hasModifiers) {
      if (onSelectProduct) {
        onSelectProduct(product);
      }
    } else {
      if (onAddToCart) {
        onAddToCart(product, 1);
      }
    }
  };

  const getStepHeading = (sectionId: string, fallback: string) => {
    return visibleSteps.find((s) => s.sectionId === sectionId)?.headingLabel || fallback;
  };

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
    if (accountRequired && (!user || !customerToken || user.emailVerified !== true)) {
      reportValidationError(
        "Entre ou crie sua conta e confirme o e-mail antes de revisar o pedido.",
        "cart-identification",
      );
      onAuthClick?.();
      return;
    }
    if (!validateSection("cart-items") || !validateSection("cart-receive-methods") || !validateSection("cart-payment-methods") || !deliveryMethod) return;

    if (!recognizedExistingCustomer && customerName.trim().length < 2) {
      reportValidationError("Informe seu nome para o restaurante identificar o pedido.", "input-guest-name");
      return;
    }
    if (normalizeBrazilianPhone(customerPhone).length < 10) {
      reportValidationError("Informe um celular válido com DDD.", "input-guest-phone");
      return;
    }

    const addressSnapshot = deliveryMethod === "delivery"
      ? deliveryAddressDraftToSnapshot(deliveryAddressDraft)
      : null;

    if (paymentDetail === "pix" && brandConfig?.pixPayerDocumentRequired && !(isValidCpf(guestDocument) || isValidCnpj(guestDocument))) {
      reportValidationError("Informe o CPF ou CNPJ do comprador para gerar o Pix PagBank.", "input-customer-document");
      return;
    }
    if (paymentDetail === "pix" && brandConfig?.pixDirect !== true && (
      brandConfig?.pixPayerDocumentRequired
        ? !isValidPixPayerEmail(guestEmail)
        : !/^\S+@\S+\.\S+$/.test(guestEmail.trim())
    )) {
      reportValidationError(
        brandConfig?.pixPayerDocumentRequired
          ? "Informe um e-mail válido para gerar o Pix."
          : "Informe um e-mail válido para gerar o pagamento Pix.",
        "input-customer-email",
      );
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
      customerDocument: paymentDetail === "pix" && brandConfig?.pixPayerDocumentRequired ? guestDocument : undefined,
      customerEmail: paymentDetail === "pix" && brandConfig?.pixDirect !== true ? guestEmail.trim().toLowerCase() : undefined,
      paymentMethodDetail: paymentDetail,
      trocoPara: paymentDetail === "dinheiro" && precisaTroco && trocoValorNum > 0 ? trocoValorNum : undefined,
      bairro: addressSnapshot?.bairro || undefined,
      cupomCodigo: couponsEnabled ? appliedCoupon?.codigo : undefined,
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
      className="fixed inset-0 z-[46] flex items-end justify-end pb-[86px] sm:pb-0 sm:items-stretch animate-fade-in cursor-pointer"
      style={{ backgroundColor: "var(--km-overlay)" }}
      id="cart-overlay"
    >
      <div
        className="flex max-h-[calc(100dvh-100px)] w-full flex-col overflow-hidden rounded-t-[28px] border border-[var(--km-line)] bg-[var(--km-dialog)] text-[var(--km-ink)] shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-[28px] sm:border-y-0 sm:border-r-0 animate-slide-left"
        id="cart-drawer-container"
        role="dialog"
        aria-modal="true"
        aria-label="Sua sacola"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="flex shrink-0 justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-[var(--km-line-strong)]" />
        </div>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--km-line-subtle)] px-5 pt-2 pb-4 sm:pt-5">
          <div className="flex items-center gap-3 min-w-0">
            <KomaBagAsset className="h-10 w-10 shrink-0" active={itemCount > 0} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-black tracking-tight text-[var(--km-ink)]">Sua sacola</h2>
                {itemCount > 0 && (
                  <span className="rounded-full bg-[var(--km-accent-soft)] border border-[var(--km-accent-border)] px-2 py-0.5 text-[11px] font-black text-[var(--km-accent-text)] tabular-nums">
                    {itemCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--km-muted)] truncate">
                {itemCount > 0 ? "Revise os passos para concluir" : "Adicione itens do cardápio"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] transition hover:text-[var(--km-ink)] cursor-pointer"
            aria-label="Fechar sacola"
            id="btn-close-cart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {cart.length > 0 && (
          <nav
            className="shrink-0 border-b border-[var(--km-line-subtle)] bg-[var(--km-panel)] px-4 py-3 sm:px-5"
            aria-label="Partes da sacola"
          >
            <div className="flex items-start justify-between">
              {visibleSteps.map((step, index) => {
                const isActive = activeSection === step.sectionId;
                const status = stepStatusMap[step.id] ?? "optional";
                const isDone = status === "done";
                const isPending = status === "pending";
                const StepIcon = step.icon;
                const isLast = index === visibleSteps.length - 1;
                return (
                  <React.Fragment key={step.sectionId}>
                    <button
                      type="button"
                      aria-label={step.accessibleName || step.label}
                      aria-expanded={isActive}
                      aria-controls={`${step.sectionId}-content`}
                      onClick={() => navigateToStep(step.sectionId)}
                      className="group relative flex flex-col items-center gap-1.5 min-w-[52px] cursor-pointer focus:outline-none"
                    >
                      <span
                        className={`relative grid h-9 w-9 place-items-center rounded-full border transition-all ${
                          isActive
                            ? isDone
                              ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)] ring-4 ring-[var(--km-accent-soft)] shadow-sm"
                              : isPending
                                ? "border-[var(--km-alert-dot)] bg-[var(--km-alert-dot)] text-[var(--km-on-alert)] ring-4 ring-[var(--km-alert-soft)] shadow-sm"
                                : "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)] ring-4 ring-[var(--km-accent-soft)] shadow-sm"
                            : isDone
                              ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]"
                              : isPending
                                ? "border-[var(--km-alert-border)] bg-[var(--km-alert-soft)] text-[var(--km-alert-text)]"
                                : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)] group-hover:border-[var(--km-line-strong)] group-hover:text-[var(--km-ink)]"
                        }`}
                      >
                        {isDone ? (
                          <Check className="h-4 w-4 stroke-[2.75]" aria-hidden="true" />
                        ) : (
                          <StepIcon className="h-4 w-4" aria-hidden="true" />
                        )}
                        {isPending && !isActive && (
                          <span
                            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--km-alert-dot)] ring-2 ring-[var(--km-panel)]"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span
                        className={`text-[10px] leading-none transition-colors ${
                          isActive
                            ? isDone
                              ? "font-black text-[var(--km-accent-text)]"
                              : isPending
                                ? "font-black text-[var(--km-alert-text)]"
                                : "font-black text-[var(--km-accent-text)]"
                            : isDone
                              ? "font-bold text-[var(--km-accent-text)]"
                              : isPending
                                ? "font-bold text-[var(--km-alert-text)]"
                                : "font-semibold text-[var(--km-muted)]"
                        }`}
                      >
                        {step.chipLabel}
                      </span>
                    </button>
                    {!isLast && (
                      <div className="mt-[17px] flex-1 px-1" aria-hidden="true">
                        <div className="h-[2px] w-full rounded-full bg-[var(--km-line)] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${isDone ? "bg-[var(--km-accent)]" : "bg-[var(--km-alert-border)]"}`}
                            style={{ width: isDone ? "100%" : isActive ? "35%" : "0%" }}
                          />
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </nav>
        )}

        {errorMessage && (
          <div className="mx-4 mt-3 flex shrink-0 items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-semibold text-rose-500 dark:text-rose-300 sm:mx-5" role="alert" id="cart-checkout-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {draftRestoreIssues.length > 0 && (
          <div className="mx-4 mt-3 flex shrink-0 items-start justify-between gap-2.5 rounded-2xl border border-[var(--km-line)] bg-[var(--km-raised)] p-3.5 text-xs text-[var(--km-ink)] sm:mx-5" role="status" id="cart-draft-restore-notice">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="font-bold text-[var(--km-ink)]">Sua sacola foi atualizada</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] leading-relaxed text-[var(--km-muted)]">
                  {draftRestoreIssues.slice(0, 3).map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            </div>
            {onDismissDraftRestoreIssues && (
              <button
                type="button"
                onClick={onDismissDraftRestoreIssues}
                aria-label="Dispensar aviso de atualização da sacola"
                className="min-h-9 min-w-9 grid place-items-center rounded-lg text-[var(--km-muted)] hover:text-[var(--km-ink)] shrink-0 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {cart.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-start p-6 text-center overflow-y-auto no-scrollbar">
            <div className="mt-6 flex flex-col items-center">
              <KomaBagAsset className="h-20 w-20" />
              <h3 className="mt-4 font-display text-xl font-black text-[var(--km-ink)]">Sua sacola está vazia</h3>
              <p className="mt-1.5 max-w-[260px] text-xs leading-relaxed text-[var(--km-muted)]">
                Escolha seus itens no cardápio para começar o pedido.
              </p>
            </div>

            {emptyCartSuggestions.length > 0 && (
              <div className="mt-7 w-full text-left">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-[var(--km-accent-text)]">
                    Destaques da Casa
                  </span>
                </div>
                <div className="space-y-2.5">
                  {emptyCartSuggestions.map((prod) => {
                      const hasModifiers = Boolean(
                        isGroupedProduct(prod) ||
                        (prod.modifierGroups && prod.modifierGroups.length > 0) ||
                        (prod.modifiers && prod.modifiers.length > 0)
                      );
                      return (
                        <div
                          key={prod.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={getProductImageUrl(prod.image)}
                              alt={prod.name}
                              className="h-13 w-13 shrink-0 rounded-xl object-cover bg-[var(--km-raised)]"
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                              }}
                            />
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-[var(--km-ink)] truncate">{prod.name}</h4>
                              <span className="font-display text-xs font-black text-[var(--km-accent-text)] tabular-nums">{isGroupedProduct(prod) && prod.hasVariablePrice ? 'A partir de ' : ''}{formatPrice(prod.price)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSuggestedProductAction(prod)}
                            className="flex items-center gap-1 px-3.5 py-2 rounded-full bg-[var(--km-accent)] hover:bg-[var(--km-accent-hover)] text-[var(--km-on-accent)] text-xs font-black shrink-0 transition cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{isGroupedProduct(prod) ? "Opções" : hasModifiers ? "Montar" : "Adicionar"}</span>
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="mt-7 w-full rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] hover:border-[var(--km-accent-border)] py-3.5 text-xs font-bold text-[var(--km-ink)] transition cursor-pointer"
            >
              Ver cardápio
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 no-scrollbar">
              {/* Status Alert */}
              {!orderingEnabled && (
                <div className="flex items-start gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs font-semibold leading-relaxed text-rose-500 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{orderingMessage}</span>
                </div>
              )}

              {/* Free Delivery Banner Progress */}
              {freeDeliveryThreshold > 0 && deliveryMethod === "delivery" && (
                <div className="rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3 text-xs">
                  {subtotal >= freeDeliveryThreshold ? (
                    <div className="flex items-center gap-2 text-[var(--km-accent-text)] font-bold">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Frete grátis liberado neste pedido!</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-semibold text-[var(--km-ink)] mb-1.5">
                        <span>Faltam <strong className="tabular-nums">{formatPrice(freeDeliveryThreshold - subtotal)}</strong></span>
                        <span className="text-[var(--km-accent-text)] font-bold">Frete grátis</span>
                      </div>
                      <div className="w-full h-1.5 bg-[var(--km-raised)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--km-accent)] rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (subtotal / freeDeliveryThreshold) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 1: Cart Items */}
              <section id="cart-items" tabIndex={-1}>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3>
                    <button
                      type="button"
                      onClick={() => navigateToStep("cart-items")}
                      aria-expanded={activeSection === "cart-items"}
                      aria-controls="cart-items-content"
                      className="min-h-10 w-full text-left text-xs font-black uppercase tracking-wider text-[var(--km-muted)] cursor-pointer"
                    >
                      {getStepHeading("cart-items", "Seu pedido")}
                    </button>
                  </h3>
                  <span className="text-xs font-bold text-[var(--km-subtle)] tabular-nums">{itemCount} {itemCount === 1 ? "item" : "itens"}</span>
                </div>
                <div id="cart-items-content" hidden={activeSection !== "cart-items"}>
                <div className="space-y-3">
                  {cart.map((item) => {
                    let unitPrice = getEffectiveProductPrice(item.product.price, item.product.promotionalPrice).effectivePrice;
                    Object.values(item.selectedOptions).forEach((opts) => {
                      opts.forEach((option) => {
                        unitPrice += option.extraPrice;
                      });
                    });

                    const itemDrift = cartCatalogDrift.get(item.id);
                    const hasEditableComposition = Boolean(
                      item.promotionId ||
                      item.product.modifiers?.length ||
                      item.product.modifierGroups?.length
                    );
                    return (
                      <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3.5" id={`cart-item-${item.id}`}>
                        <img
                          src={getProductImageUrl(item.product.image)}
                          alt={item.product.name}
                          className="h-16 w-16 shrink-0 rounded-xl object-cover bg-[var(--km-raised)]"
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-[var(--km-ink)] leading-snug">{item.quantity}× {item.product.name}</h4>
                          {item.promotionParts ? (
                            <div className="mt-2 space-y-2 text-xs text-[var(--km-muted)]">
                              {item.promotionParts.map((part, index) => (
                                <div key={index} className="rounded-xl border border-[var(--km-line-subtle)] p-2 bg-[var(--km-panel)]">
                                  <strong className="text-[var(--km-ink)]">{part.product.name}</strong>
                                  <p>{Object.values(part.selectedOptions).flat().map(option => option.name).join(', ') || 'Sem adicionais'}</p>
                                  {part.notes && <p>Obs.: {part.notes}</p>}
                                </div>
                              ))}
                            </div>
                          ) : <OrderItemComposition item={cardapioCompositionSource(item)} className="mt-1 text-[var(--km-muted)] text-xs" />}
                          {itemDrift && (
                            <div
                              id={`cart-item-drift-${item.id}`}
                              role="status"
                              className={`mt-2 flex items-start gap-2 rounded-xl border p-2.5 text-[11px] font-semibold leading-relaxed ${
                                itemDrift.canEdit
                                  ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]"
                                  : "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-300"
                              }`}
                            >
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>{itemDrift.message}</span>
                            </div>
                          )}
                          {onEditItem && hasEditableComposition && (!itemDrift || itemDrift.canEdit) && (
                            <button type="button" onClick={() => onEditItem(item)} className="mt-1.5 inline-flex min-h-9 items-center text-xs font-bold text-[var(--km-accent-text)] hover:underline cursor-pointer" aria-label={`Editar montagem de ${item.product.name}`}>
                              Editar montagem
                            </button>
                          )}
                          {onComposeAnother && hasEditableComposition && (
                            <button type="button" onClick={() => onComposeAnother(item)} className="mt-1 block min-h-9 text-xs font-bold text-[var(--km-accent-text)] hover:underline cursor-pointer" aria-label={`Montar outra diferente de ${item.product.name}`}>
                              Montar outra diferente
                            </button>
                          )}
                          {item.notes && (
                            <p className="mt-1.5 inline-block rounded-lg bg-[var(--km-raised)] px-2 py-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--km-ink-2)]">
                              Obs.: {item.notes}
                            </p>
                          )}
                          {item.quantity > 1 && <p className="mt-1 text-[11px] text-[var(--km-muted)] tabular-nums">{formatPrice(unitPrice)} cada</p>}
                          <strong className="mt-1.5 block font-display text-sm font-black text-[var(--km-accent-text)] tabular-nums">{formatPrice(unitPrice * item.quantity)}</strong>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2.5">
                          <button type="button" onClick={() => onRemoveItem(item.id)} className="grid h-8 w-8 place-items-center rounded-xl text-[var(--km-muted)] transition hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer" aria-label={`Remover ${item.product.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <div className="flex items-center gap-1 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] p-0.5">
                            <button type="button" onClick={() => (onAdjustQty ? onAdjustQty(item.id, -1) : onUpdateQty(item.id, item.quantity - 1))} className="grid h-7 w-7 place-items-center rounded-full text-[var(--km-ink-2)] transition hover:bg-[var(--km-card)] hover:text-rose-400 cursor-pointer" aria-label={`Diminuir ${item.product.name}`}>
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="min-w-[22px] text-center text-xs font-black text-[var(--km-ink)] tabular-nums">{item.quantity}</span>
                            <button type="button" onClick={() => (onAdjustQty ? onAdjustQty(item.id, 1) : onUpdateQty(item.id, item.quantity + 1))} className="grid h-7 w-7 place-items-center rounded-full text-[var(--km-ink-2)] transition hover:bg-[var(--km-card)] hover:text-[var(--km-accent-text)] cursor-pointer" aria-label={`Aumentar ${item.product.name}`}>
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

              {/* Upselling / Cross-selling Carousel */}
              {activeSection === "cart-items" && upsellSuggestions.length > 0 && onAddToCart && (
                <section className="border-t border-[var(--km-line-subtle)] pt-4" aria-label="Sugestões para acompanhar">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="grid h-6 w-6 place-items-center rounded-lg bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]">
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                    <h3 className="text-[11px] font-black uppercase tracking-wider text-[var(--km-ink-2)]">{upsellHeading}</h3>
                  </div>
                  <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
                    {upsellSuggestions.map((prod) => {
                      const grouped = isGroupedProduct(prod);
                      const cartItem = grouped ? undefined : cart.find((item) => String(item.product.id) === String(prod.id));
                      const qty = grouped
                        ? cart.reduce((sum, item) =>
                            sum + (prod.variants.some((variant) => String(variant.id) === String(item.product.id)) ? item.quantity : 0), 0)
                        : (cartItem?.quantity ?? 0);
                      const hasModifiers = Boolean(
                        grouped ||
                        (prod.modifierGroups && prod.modifierGroups.length > 0) ||
                        (prod.modifiers && prod.modifiers.length > 0)
                      );
                      const isAvailable = prod.isAvailable !== false;

                      return (
                        <div
                          key={prod.id}
                          id={`upsell-card-${prod.id}`}
                          className="min-w-[144px] max-w-[144px] bg-[var(--km-card)] border border-[var(--km-line)] rounded-2xl p-2.5 flex flex-col justify-between shrink-0"
                        >
                          <img
                            src={getProductImageUrl(prod.image)}
                            alt={prod.name}
                            className="h-18 w-full rounded-xl object-cover mb-2 bg-[var(--km-raised)]"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                            }}
                          />
                          <div>
                            <h4 className="text-xs font-bold text-[var(--km-ink)] line-clamp-1">{prod.name}</h4>
                            <span className="font-display text-xs font-black text-[var(--km-accent-text)] block mt-0.5 tabular-nums">{grouped && prod.hasVariablePrice ? 'A partir de ' : ''}{formatPrice(prod.price)}</span>
                          </div>

                          {!isAvailable ? (
                            <span className="mt-2.5 w-full py-1 px-2 text-center text-[10px] font-bold text-[var(--km-muted)] bg-[var(--km-raised)] rounded-full">
                              Indisponível
                            </span>
                          ) : qty > 0 && !hasModifiers ? (
                            <div className="mt-2.5 flex items-center justify-between w-full rounded-full bg-[var(--km-accent-soft)] border border-[var(--km-accent-border)] px-1.5 py-1">
                              <button
                                type="button"
                                onClick={() => (onAdjustQty ? onAdjustQty(cartItem!.id, -1) : onUpdateQty(cartItem!.id, qty - 1))}
                                className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-[var(--km-card)] text-[var(--km-accent-text)] cursor-pointer"
                                aria-label={`Diminuir ${prod.name}`}
                                id={`btn-upsell-dec-${prod.id}`}
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-black text-[var(--km-accent-text)] tabular-nums" id={`upsell-qty-${prod.id}`}>
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => (onAdjustQty ? onAdjustQty(cartItem!.id, 1) : onUpdateQty(cartItem!.id, qty + 1))}
                                className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-[var(--km-card)] text-[var(--km-accent-text)] cursor-pointer"
                                aria-label={`Aumentar ${prod.name}`}
                                id={`btn-upsell-inc-${prod.id}`}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ) : qty > 0 && hasModifiers ? (
                            <button
                              type="button"
                              onClick={() => handleSuggestedProductAction(prod)}
                              className="mt-2.5 w-full py-1.5 px-2 bg-[var(--km-accent-soft)] text-[var(--km-accent-text)] border border-[var(--km-accent-border)] rounded-full text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer"
                              id={`btn-upsell-edit-${prod.id}`}
                              aria-label={`Montar outra ${prod.name}`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--km-accent)] shrink-0" />
                              <span>{grouped ? "Opções" : `Outra (${qty})`}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSuggestedProductAction(prod)}
                              className="mt-2.5 w-full py-1.5 px-2 bg-[var(--km-accent-soft)] hover:bg-[var(--km-accent)] hover:text-[var(--km-on-accent)] text-[var(--km-accent-text)] border border-[var(--km-accent-border)] rounded-full text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer"
                              id={`btn-upsell-add-${prod.id}`}
                              aria-label={`Adicionar ${prod.name}`}
                            >
                              <Plus className="w-3 h-3" /> {grouped ? "Opções" : hasModifiers ? "Montar" : "Adicionar"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Section 2: Delivery Method & Address */}
              <section className="border-t border-[var(--km-line-subtle)] pt-4" id="cart-receive-methods" tabIndex={-1} aria-describedby={invalidField === "cart-receive-methods" ? "cart-checkout-error" : undefined}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-receive-methods")}
                    aria-expanded={activeSection === "cart-receive-methods"}
                    aria-controls="cart-receive-methods-content"
                    className="min-h-10 w-full text-left text-xs font-black uppercase tracking-wider text-[var(--km-muted)] cursor-pointer"
                  >
                    {getStepHeading("cart-receive-methods", "Como receber")}
                  </button>
                </h3>
                <div id="cart-receive-methods-content" hidden={activeSection !== "cart-receive-methods"}>
                <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={!pickupEnabled}
                    aria-pressed={deliveryMethod === "pickup"}
                    onClick={() => { if (pickupEnabled) setDeliveryMethod("pickup"); clearValidation("cart-receive-methods"); }}
                    className={`relative flex min-h-[82px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                      deliveryMethod === "pickup"
                        ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)] text-[var(--km-ink)] ring-2 ring-[var(--km-accent-soft)]"
                        : "border-[var(--km-line)] bg-[var(--km-card)] text-[var(--km-ink-2)] hover:border-[var(--km-line-strong)]"
                    }`}
                  >
                    {deliveryMethod === "pickup" && (
                      <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-[var(--km-accent-text)]" aria-hidden="true" />
                    )}
                    <KomaPickupAsset className="h-10 w-10 shrink-0" />
                    <strong className="text-xs font-black leading-tight text-[var(--km-ink)]">Retirada</strong>
                    <span className="text-[10px] leading-tight text-[var(--km-muted)]">{pickupEnabled ? "No balcão" : "Indisponível"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!dineInEnabled}
                    aria-pressed={deliveryMethod === "dine_in"}
                    onClick={() => { if (dineInEnabled) setDeliveryMethod("dine_in"); clearValidation("cart-receive-methods"); }}
                    className={`relative flex min-h-[82px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                      deliveryMethod === "dine_in"
                        ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)] text-[var(--km-ink)] ring-2 ring-[var(--km-accent-soft)]"
                        : "border-[var(--km-line)] bg-[var(--km-card)] text-[var(--km-ink-2)] hover:border-[var(--km-line-strong)]"
                    }`}
                  >
                    {deliveryMethod === "dine_in" && (
                      <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-[var(--km-accent-text)]" aria-hidden="true" />
                    )}
                    <KomaDineInAsset className="h-10 w-10 shrink-0" />
                    <strong className="text-xs font-black leading-tight text-[var(--km-ink)]">Consumo local</strong>
                    <span className="text-[10px] leading-tight text-[var(--km-muted)]">{dineInEnabled ? "Na mesa" : "Indisponível"}</span>
                  </button>

                  {(() => {
                    const deliveryLabel = deliveryQuote.fee === 0 ? "Grátis" : formatPrice(deliveryQuote.fee);
                    return (
                      <button
                        type="button"
                        disabled={!deliveryEnabled} aria-pressed={deliveryMethod === "delivery"}
                        onClick={() => { if (deliveryEnabled) setDeliveryMethod("delivery"); clearValidation("cart-receive-methods"); }}
                        className={`relative flex min-h-[82px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                          deliveryMethod === "delivery"
                            ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)] text-[var(--km-ink)] ring-2 ring-[var(--km-accent-soft)]"
                            : "border-[var(--km-line)] bg-[var(--km-card)] text-[var(--km-ink-2)] hover:border-[var(--km-line-strong)]"
                        }`}
                      >
                        {deliveryMethod === "delivery" && (
                          <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-[var(--km-accent-text)]" aria-hidden="true" />
                        )}
                        <KomaDeliveryAsset className="h-10 w-10 shrink-0" />
                        <strong className="text-xs font-black leading-tight text-[var(--km-ink)]">Entrega</strong>
                        <span className="text-[10px] leading-tight text-[var(--km-muted)] truncate max-w-full">
                          {deliveryEnabled ? deliveryLabel : "Indisponível no momento"}
                        </span>
                      </button>
                    );
                  })()}
                </div>

                {deliveryMethod === "dine_in" && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3.5">
                    <Store className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" />
                    <div className="min-w-0 text-xs leading-relaxed">
                      <strong className="text-[var(--km-ink)] font-bold">Consumo local</strong>
                      <p className="mt-0.5 text-[var(--km-muted)]">O restaurante pode associar seu pedido a uma mesa depois.</p>
                      {restaurantAddress && <p className="mt-1 break-words text-[var(--km-subtle)] text-[11px]">{restaurantAddress}</p>}
                    </div>
                  </div>
                )}

                {deliveryMethod === "pickup" && restaurantAddress && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3.5">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" />
                    <div className="min-w-0 text-xs leading-relaxed"><strong className="text-[var(--km-ink)] font-bold">Local de retirada</strong><p className="mt-0.5 break-words text-[var(--km-muted)] text-[11px]">{restaurantAddress}</p></div>
                  </div>
                )}

                {deliveryMethod === "delivery" && (
                  <div className="mt-3 space-y-3">
                    {neighborhoodFees.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--km-muted)]">
                            Bairro para entrega
                          </span>
                          {selectedNeighborhoodItem && (
                            <span className="rounded-full bg-[var(--km-accent-soft)] border border-[var(--km-accent-border)] px-2.5 py-0.5 text-[11px] font-black text-[var(--km-accent-text)] tabular-nums">
                              {selectedNeighborhoodItem.taxa === 0 ? "Entrega grátis" : `Taxa ${formatPrice(selectedNeighborhoodItem.taxa)}`}
                            </span>
                          )}
                        </div>

                        <div className="relative">
                          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--km-accent-text)]" aria-hidden="true" />
                          <input
                            type="text"
                            id="input-search-bairro"
                            autoComplete="address-level3"
                            value={selectedBairro}
                            onFocus={() => setIsBairroPickerOpen(true)}
                            onChange={(event) => {
                              const nextVal = event.target.value;
                              const nextAddress = updateDeliveryAddressGeographicField(deliveryAddressDraft, "bairro", nextVal);
                              setDeliveryAddressDraft(nextAddress);
                              setSelectedBairro(nextVal);
                              setBairroSearch(nextVal);
                              const snapshot = deliveryAddressDraftToSnapshot(nextAddress);
                              setAddress(snapshot ? formatDeliveryAddressLegacy(snapshot) : "");
                              setLegacyAddressHint(null);
                              setIsBairroPickerOpen(true);
                              clearValidation("cart-receive-methods");
                            }}
                            placeholder="Digite seu bairro para ver a taxa..."
                            aria-label="Bairro para entrega"
                            aria-expanded={isBairroPickerOpen}
                            className="h-12 w-full rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] pl-10 pr-20 text-sm font-semibold text-[var(--km-ink)] outline-none transition placeholder:text-[var(--km-subtle)] focus:border-[var(--km-focus)]"
                          />
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            {selectedBairro && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextAddress = updateDeliveryAddressGeographicField(deliveryAddressDraft, "bairro", "");
                                  setDeliveryAddressDraft(nextAddress);
                                  setSelectedBairro("");
                                  setBairroSearch("");
                                  const snapshot = deliveryAddressDraftToSnapshot(nextAddress);
                                  setAddress(snapshot ? formatDeliveryAddressLegacy(snapshot) : "");
                                  setIsBairroPickerOpen(true);
                                }}
                                aria-label="Limpar bairro"
                                className="grid h-7 w-7 place-items-center rounded-full text-[var(--km-muted)] hover:bg-[var(--km-raised)] hover:text-[var(--km-ink)] cursor-pointer"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              id="btn-select-bairro"
                              onClick={() => setIsBairroPickerOpen((open) => !open)}
                              aria-label={isBairroPickerOpen ? "Fechar lista de bairros" : "Ver bairros atendidos"}
                              className="grid h-7 w-7 place-items-center rounded-full text-[var(--km-muted)] hover:bg-[var(--km-raised)] hover:text-[var(--km-ink)] cursor-pointer"
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${isBairroPickerOpen ? "rotate-180 text-[var(--km-accent-text)]" : ""}`} />
                            </button>
                          </div>
                        </div>

                        {isBairroPickerOpen && (
                          <div
                            id="bairro-picker-panel"
                            className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-2 shadow-lg"
                          >
                            <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1.5 p-1">
                              {filteredNeighborhoods.length === 0 ? (
                                <p className="w-full py-2 text-center text-xs text-[var(--km-muted)]">
                                  &ldquo;{selectedBairro}&rdquo; não está na lista — será usada a taxa padrão ({formatPrice(deliveryQuote.fee)}).
                                </p>
                              ) : (
                                filteredNeighborhoods.map((item) => {
                                  const isSelected = selectedBairro.trim().toLowerCase() === item.bairro.trim().toLowerCase();
                                  return (
                                    <button
                                      key={item.bairro}
                                      type="button"
                                      onClick={() => {
                                        const nextAddress = updateDeliveryAddressGeographicField(deliveryAddressDraft, "bairro", item.bairro);
                                        setDeliveryAddressDraft(nextAddress);
                                        setSelectedBairro(item.bairro);
                                        setBairroSearch("");
                                        const snapshot = deliveryAddressDraftToSnapshot(nextAddress);
                                        setAddress(snapshot ? formatDeliveryAddressLegacy(snapshot) : "");
                                        setLegacyAddressHint(null);
                                        setIsBairroPickerOpen(false);
                                        clearValidation("cart-receive-methods");
                                      }}
                                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition cursor-pointer ${
                                        isSelected
                                          ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] font-bold text-[var(--km-accent-text)]"
                                          : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] hover:border-[var(--km-accent-border)] hover:text-[var(--km-ink)]"
                                      }`}
                                    >
                                      {isSelected && <Check className="h-3 w-3 shrink-0 stroke-[2.75]" aria-hidden="true" />}
                                      <span>{item.bairro}</span>
                                      <span className="font-extrabold tabular-nums opacity-85">
                                        {item.taxa === 0 ? "Grátis" : formatPrice(item.taxa)}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <DeliveryAddressFields
                      value={deliveryAddressDraft}
                      onChange={(nextAddress) => {
                        setDeliveryAddressDraft(nextAddress);
                        setSelectedBairro(nextAddress.bairro);
                        const snapshot = deliveryAddressDraftToSnapshot(nextAddress);
                        setAddress(snapshot ? formatDeliveryAddressLegacy(snapshot) : "");
                        setLegacyAddressHint(null);
                        clearValidation("delivery-address-logradouro");
                      }}
                      neighborhoodOptions={[]}
                      legacyHint={legacyAddressHint}
                      idPrefix="delivery-address"
                      hideBairroField={neighborhoodFees.length > 0}
                    />
                    <p className="break-words text-xs leading-relaxed text-[var(--km-muted)]" aria-live="polite">
                      {selectedBairro
                        ? (brandConfig?.tabelaTaxasBairros || []).some((item) => item.bairro.toLowerCase() === selectedBairro.trim().toLowerCase())
                          ? `${selectedBairro}: taxa de ${formatPrice(deliveryQuote.fee)} incluída.`
                          : `${selectedBairro}: taxa padrão de ${formatPrice(deliveryQuote.fee)} incluída.`
                        : deliveryQuote.fee === 0
                          ? "Sem taxa de entrega neste pedido."
                          : `Taxa padrão de ${formatPrice(deliveryQuote.fee)} incluída no resumo.`}
                    </p>
                  </div>
                )}
                </div>
              </section>

              {/* Section 3: Cupons & Descontos */}
              {showDiscounts && <section className="border-t border-[var(--km-line-subtle)] pt-4" id="cart-discounts" tabIndex={-1}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-discounts")}
                    aria-expanded={activeSection === "cart-discounts"}
                    aria-controls="cart-discounts-content"
                    className="min-h-10 w-full text-left text-xs font-black uppercase tracking-wider text-[var(--km-muted)] cursor-pointer"
                  >
                    {getStepHeading("cart-discounts", "Descontos")}
                  </button>
                </h3>
                <div id="cart-discounts-content" hidden={activeSection !== "cart-discounts"}>

                {/* Coupon Box */}
                {couponsEnabled && (appliedCoupon ? (
                  <div className="flex items-center justify-between p-3.5 bg-[var(--km-accent-soft)] border border-[var(--km-accent-border)] rounded-2xl text-xs">
                    <div className="flex items-center gap-2.5">
                      <Ticket className="w-4 h-4 text-[var(--km-accent-text)] shrink-0" />
                      <div>
                        <span className="font-mono font-bold text-[var(--km-ink)]">{appliedCoupon.codigo}</span>
                        <p className="text-[11px] text-[var(--km-accent-text)] mt-0.5">{appliedCoupon.mensagem} (- {formatPrice(appliedCoupon.desconto)})</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="p-1 text-[var(--km-muted)] hover:text-rose-400 rounded-lg cursor-pointer"
                      title="Remover cupom"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleApplyCoupon} className="flex gap-2">
                    <div className="relative flex-1">
                      <Ticket className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--km-muted)]" />
                      <input
                        type="text"
                        placeholder="Código do cupom..."
                        value={couponCode}
                        onChange={(e) => {
                          const nextCode = e.target.value.toUpperCase();
                          setCouponCode(nextCode);
                          setCouponError("");
                          if (!nextCode.trim()) setPendingCouponAfterPhone(false);
                        }}
                        aria-label="Código do cupom"
                        className="min-h-12 w-full pl-10 pr-3 py-2 bg-[var(--km-input)] border border-[var(--km-line)] rounded-2xl text-base sm:text-xs font-mono font-bold uppercase text-[var(--km-ink)] placeholder:normal-case placeholder:font-normal placeholder:text-[var(--km-subtle)] focus:outline-none focus:border-[var(--km-focus)] tracking-wider"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={validatingCoupon || !couponCode.trim()}
                      className="px-5 py-2 bg-[var(--km-raised)] hover:bg-[var(--km-accent)] hover:text-[var(--km-on-accent)] border border-[var(--km-line)] rounded-2xl text-xs font-bold text-[var(--km-ink)] transition-all disabled:opacity-40 cursor-pointer"
                    >
                      {validatingCoupon ? "..." : "Aplicar"}
                    </button>
                  </form>
                ))}
                {couponsEnabled && couponError && (
                  <p className="text-[11px] text-rose-500 dark:text-rose-300 font-semibold mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {couponError}
                  </p>
                )}

                {/* Cashback Toggle (if user has balance) */}
                {userCashbackBalance > 0 && (
                  <div className="mt-3 p-3.5 bg-[var(--km-accent-soft)] border border-[var(--km-accent-border)] rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Coins className="w-4 h-4 text-[var(--km-accent-text)] shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-[var(--km-ink)]">Saldo de Cashback</span>
                        <p className="text-[11px] text-[var(--km-muted)] tabular-nums">Disponível: {formatPrice(userCashbackBalance)}</p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useCashback}
                        onChange={(e) => setUseCashback(e.target.checked)}
                        className="h-4 w-4 rounded accent-[var(--km-accent)]"
                      />
                      <span className="text-xs font-bold text-[var(--km-accent-text)]">Usar</span>
                    </label>
                  </div>
                )}
                </div>
              </section>}

              {/* Section 4: Forma de Pagamento & Troco */}
              <section className="border-t border-[var(--km-line-subtle)] pt-4" id="cart-payment-methods" tabIndex={-1} aria-describedby={invalidField === "cart-payment-methods" ? "cart-checkout-error" : undefined}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-payment-methods")}
                    aria-expanded={activeSection === "cart-payment-methods"}
                    aria-controls="cart-payment-methods-content"
                    className="min-h-10 w-full text-left text-xs font-black uppercase tracking-wider text-[var(--km-muted)] cursor-pointer"
                  >
                    {getStepHeading("cart-payment-methods", "Como pagar")}
                  </button>
                </h3>
                <div id="cart-payment-methods-content" hidden={activeSection !== "cart-payment-methods"}>
                <p className="mt-1.5 mb-3 text-xs leading-relaxed text-[var(--km-muted)]">{availablePayments.includes("pix") && "Pix libera o pedido após confirmação. "}{availablePayments.some(method => method !== "pix") && <>Presencial: pague {deliveryMethod === "delivery" ? "na entrega" : deliveryMethod === "dine_in" ? "no restaurante" : "na retirada"}.</>}</p>

                <CardapioPaymentOptions available={availablePayments} selected={paymentDetail} onSelect={selectPayment} />

                {/* Troco Calculator for Dinheiro */}
                {paymentDetail === "dinheiro" && (
                  <div className="mt-3.5 p-3.5 bg-[var(--km-card)] border border-[var(--km-line)] rounded-2xl space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--km-ink)]">Precisa de troco?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-pressed={!precisaTroco}
                          onClick={() => setPrecisaTroco(false)}
                          className={`min-h-10 min-w-12 px-4 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${!precisaTroco ? 'bg-[var(--km-accent)] text-[var(--km-on-accent)]' : 'bg-[var(--km-raised)] border border-[var(--km-line)] text-[var(--km-muted)]'}`}
                        >
                          Não
                        </button>
                        <button
                          type="button"
                          aria-pressed={precisaTroco}
                          onClick={() => setPrecisaTroco(true)}
                          className={`min-h-10 min-w-12 px-4 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${precisaTroco ? 'bg-[var(--km-accent)] text-[var(--km-on-accent)]' : 'bg-[var(--km-raised)] border border-[var(--km-line)] text-[var(--km-muted)]'}`}
                        >
                          Sim
                        </button>
                      </div>
                    </div>

                    {precisaTroco && (
                      <div className="space-y-2.5 pt-2.5 border-t border-[var(--km-line-subtle)]">
                        <label htmlFor="payment-change-for" className="block text-xs font-semibold text-[var(--km-ink)]">Troco para qual cédula?</label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[20, 50, 100].map((val) => {
                            const isPicked = trocoPara === String(val);
                            return (
                              <button
                                key={val}
                                type="button"
                                aria-pressed={isPicked}
                                onClick={() => {
                                  setTrocoPara(String(val));
                                  clearValidation("payment-change-for");
                                }}
                                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-2 text-xs font-black tabular-nums transition cursor-pointer ${
                                  isPicked
                                    ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)] ring-2 ring-[var(--km-accent-soft)]"
                                    : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink)] hover:border-[var(--km-accent-border)]"
                                }`}
                              >
                                <Banknote className={`h-3.5 w-3.5 ${isPicked ? "text-[var(--km-accent-text)]" : "text-[var(--km-muted)]"}`} aria-hidden="true" />
                                <span>R$ {val}</span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            aria-pressed={Boolean(trocoPara) && !["20", "50", "100"].includes(trocoPara)}
                            onClick={() => {
                              if (["20", "50", "100"].includes(trocoPara)) setTrocoPara("");
                              clearValidation("payment-change-for");
                              window.requestAnimationFrame(() => trocoInputRef.current?.focus());
                            }}
                            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-2 text-[11px] font-bold transition cursor-pointer ${
                              Boolean(trocoPara) && !["20", "50", "100"].includes(trocoPara)
                                ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)] ring-2 ring-[var(--km-accent-soft)]"
                                : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)] hover:border-[var(--km-accent-border)] hover:text-[var(--km-ink)]"
                            }`}
                          >
                            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Outro valor</span>
                          </button>
                        </div>
                        <div className="relative mt-1">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--km-muted)]">R$</span>
                          <input
                            ref={trocoInputRef}
                            type="number"
                            id="payment-change-for"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="Outro valor..."
                            value={trocoPara}
                            onChange={(e) => { setTrocoPara(e.target.value); clearValidation("payment-change-for"); }}
                            aria-invalid={invalidField === "payment-change-for"}
                            aria-describedby={invalidField === "payment-change-for" ? "cart-checkout-error" : undefined}
                            className={`min-h-12 w-full pl-10 pr-3 py-2 bg-[var(--km-input)] border rounded-2xl text-base font-bold tabular-nums text-[var(--km-ink)] outline-none focus:border-[var(--km-focus)] ${invalidField === "payment-change-for" ? "border-rose-500" : "border-[var(--km-line)]"}`}
                          />
                        </div>
                        {trocoCalculado > 0 && (
                          <div className="flex items-center justify-between rounded-xl bg-[var(--km-accent-soft)] px-3 py-2 text-xs font-bold text-[var(--km-accent-text)]">
                            <span>Seu troco será</span>
                            <span className="tabular-nums">{formatPrice(trocoCalculado)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                </div>
              </section>

              {/* Section 5: Identification */}
              <section className="border-t border-[var(--km-line-subtle)] pt-4" id="cart-identification" tabIndex={-1}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-identification")}
                    aria-expanded={activeSection === "cart-identification"}
                    aria-controls="cart-identification-content"
                    className="min-h-10 w-full text-left text-xs font-black uppercase tracking-wider text-[var(--km-muted)] cursor-pointer"
                  >
                    {getStepHeading("cart-identification", "Seus dados")}
                  </button>
                </h3>
                <div id="cart-identification-content" hidden={activeSection !== "cart-identification"}>
                {user ? (
                  <div className="mt-3 flex items-start gap-3 rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" />
                    <div>
                      <p className="text-xs font-black text-[var(--km-ink)]">{user.name}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--km-muted)]">{formatBrazilianPhone(user.phone || "")} · identificado</p>
                    </div>
                  </div>
                ) : accountRequired ? (
                  <div className="mt-3 rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3.5">
                    <p className="text-xs font-black text-[var(--km-ink)]">Conta necessária para pedir</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--km-muted)]">
                      Entre ou crie sua conta para continuar.
                    </p>
                    {onAuthClick && (
                      <button
                        type="button"
                        onClick={onAuthClick}
                        className="mt-3 min-h-11 w-full rounded-full bg-[var(--km-accent)] px-4 text-xs font-black text-[var(--km-on-accent)] transition hover:bg-[var(--km-accent-hover)] cursor-pointer"
                      >
                        Entrar ou criar conta
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--km-muted)]">Celular com DDD</span>
                      <span className="relative block"><Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--km-muted)]" /><input type="tel" inputMode="numeric" autoComplete="tel" placeholder="(00) 00000-0000" value={guestPhone} onChange={(event) => { setGuestPhone(formatBrazilianPhone(event.target.value)); clearValidation("input-guest-phone"); }} aria-invalid={invalidField === "input-guest-phone"} aria-describedby={invalidField === "input-guest-phone" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-2xl border bg-[var(--km-input)] pl-11 pr-4 text-sm text-[var(--km-ink)] outline-none transition placeholder:text-[var(--km-subtle)] focus:border-[var(--km-focus)] ${invalidField === "input-guest-phone" ? "border-rose-500" : "border-[var(--km-line)]"}`} id="input-guest-phone" /></span>
                    </label>
                    {customerRecognition === "checking" && (
                      <p className="text-[11px] font-semibold text-[var(--km-muted)]" role="status">Conferindo seu celular...</p>
                    )}
                    {customerRecognition === "found" && (
                      <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-3.5 py-2.5" role="status">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" />
                        <p className="text-[11px] font-semibold leading-relaxed text-[var(--km-accent-text)]">Reconhecemos seu celular! Pode continuar direto.</p>
                      </div>
                    )}
                    {customerRecognition === "new" && (
                      <p className="text-[11px] font-semibold leading-relaxed text-[var(--km-muted)]" role="status">Primeiro pedido com este número? Informe seu nome.</p>
                    )}
                    {customerRecognition !== "found" && (
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--km-muted)]">Seu nome</span>
                        <span className="relative block"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--km-muted)]" /><input type="text" autoComplete="name" maxLength={100} placeholder="Como devemos chamar você?" value={guestName} onChange={(event) => { setGuestName(event.target.value); clearValidation("input-guest-name"); }} aria-invalid={invalidField === "input-guest-name"} aria-describedby={invalidField === "input-guest-name" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-2xl border bg-[var(--km-input)] pl-11 pr-4 text-sm text-[var(--km-ink)] outline-none transition placeholder:text-[var(--km-subtle)] focus:border-[var(--km-focus)] ${invalidField === "input-guest-name" ? "border-rose-500" : "border-[var(--km-line)]"}`} id="input-guest-name" /></span>
                      </label>
                    )}
                    {onAuthClick && (
                      <div className="rounded-3xl border border-[var(--km-line)] bg-[var(--km-card)] p-4 shadow-sm">
                        <div className="flex items-center gap-3.5">
                          <KomaAccountInviteAsset className="h-14 w-14 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-extrabold leading-snug text-[var(--km-ink)]">
                              Peça em 1 toque da próxima vez
                            </p>
                            <p className="mt-0.5 text-[11px] leading-snug text-[var(--km-muted)]">
                              Salve seu endereço e repita pedidos sem digitar tudo de novo.
                            </p>
                            <button
                              type="button"
                              onClick={onAuthClick}
                              className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--km-accent)] px-4 py-1.5 text-xs font-black text-[var(--km-on-accent)] transition hover:bg-[var(--km-accent-hover)] cursor-pointer"
                            >
                              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Entrar ou criar conta</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {couponsEnabled && pendingCouponAfterPhone && couponCode.trim() && !appliedCoupon && (
                      <div className="rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3.5 text-xs" role="status" id="pending-coupon-phone-banner">
                        <div className="flex items-start gap-2.5">
                          <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[var(--km-ink)]">Cupom {couponCode.trim().toUpperCase()} aguardando aplicação</p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--km-muted)]">
                              {isCompleteBrazilianPhone(guestPhone)
                                ? "Celular informado. Aplique o cupom antes de revisar."
                                : "Preencha seu celular acima para aplicar o cupom."}
                            </p>
                            {couponError && (
                              <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-rose-500 dark:text-rose-300">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {couponError}
                              </p>
                            )}
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={validatingCoupon || !isCompleteBrazilianPhone(guestPhone)}
                                onClick={() => void handleApplyCoupon()}
                                id="btn-apply-pending-coupon"
                                className="min-h-10 rounded-xl bg-[var(--km-accent)] px-3.5 py-2 text-xs font-black text-[var(--km-on-accent)] transition hover:bg-[var(--km-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                              >
                                {validatingCoupon ? "Validando..." : `Aplicar ${couponCode.trim().toUpperCase()}`}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingCouponAfterPhone(false)}
                                className="min-h-10 rounded-xl border border-[var(--km-line)] px-3 py-2 text-xs font-semibold text-[var(--km-muted)] transition hover:text-[var(--km-ink)] cursor-pointer"
                              >
                                Continuar sem cupom
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {paymentDetail === "pix" && brandConfig?.pixPayerDocumentRequired && (
                  <label className="mt-3 block text-xs text-[var(--km-muted)]">CPF ou CNPJ do comprador
                    <input id="input-customer-document" inputMode="numeric" autoComplete="off" maxLength={14}
                      value={guestDocument} onChange={event => { setGuestDocument(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); clearValidation("input-customer-document"); }}
                      aria-invalid={invalidField === "input-customer-document"}
                      className="mt-1 h-12 w-full rounded-2xl border border-[var(--km-line)] bg-[var(--km-input)] px-4 text-sm text-[var(--km-ink)] outline-none focus:border-[var(--km-focus)]" />
                    <span className="mt-1 block text-[11px]">Necessário para emitir o Pix deste pedido.</span>
                  </label>
                )}
                {paymentDetail === "pix" && brandConfig?.pixDirect !== true && (
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--km-muted)]">E-mail para o Pix</span>
                    <span className="relative block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--km-muted)]" /><input type="email" autoComplete="email" maxLength={254} placeholder="voce@exemplo.com" value={guestEmail} onChange={(event) => { setGuestEmail(event.target.value); clearValidation("input-customer-email"); }} aria-invalid={invalidField === "input-customer-email"} aria-describedby={invalidField === "input-customer-email" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-2xl border bg-[var(--km-input)] pl-11 pr-4 text-sm text-[var(--km-ink)] outline-none transition placeholder:text-[var(--km-subtle)] focus:border-[var(--km-focus)] ${invalidField === "input-customer-email" ? "border-rose-500" : "border-[var(--km-line)]"}`} id="input-customer-email" /></span>
                  </label>
                )}
                </div>
              </section>

            </div>

            {/* Footer Summary & Action */}
            <div className="shrink-0 border-t border-[var(--km-line-subtle)] bg-[var(--km-panel)] p-4 sm:p-5">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-[var(--km-muted)]"><span>Subtotal</span><span className="tabular-nums">{formatPrice(subtotal)}</span></div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-[var(--km-muted)]">
                    <span>Taxa de entrega</span>
                    <span className={`tabular-nums ${deliveryFee === 0 ? "text-[var(--km-accent-text)] font-bold" : ""}`}>
                      {deliveryFee === 0 ? "Grátis" : formatPrice(deliveryFee)}
                    </span>
                  </div>
                )}
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-[var(--km-accent-text)] font-bold">
                    <span>Cupom ({appliedCoupon?.codigo})</span>
                    <span className="tabular-nums">- {formatPrice(couponDiscount)}</span>
                  </div>
                )}
                {cashbackDiscount > 0 && (
                  <div className="flex justify-between text-[var(--km-accent-text)] font-bold">
                    <span>Cashback resgatado</span>
                    <span className="tabular-nums">- {formatPrice(cashbackDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-[var(--km-line-subtle)] pt-2 text-sm font-black text-[var(--km-ink)]">
                  <span>Total estimado</span>
                  <span className="font-display text-lg font-black text-[var(--km-accent-text)] tabular-nums">{formatPrice(total)}</span>
                </div>
              </div>
              {remainingMinimum > 0 && (
                <p className="mt-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold leading-relaxed text-rose-500 dark:text-rose-300" role="status">
                  Faltam <strong className="tabular-nums">{formatPrice(remainingMinimum)}</strong> para o pedido mínimo ({formatPrice(minimumOrder)}).
                </p>
              )}
              <button
                type="button"
                onClick={() => nextSection ? continueToSection(nextSection) : handleCheckout()}
                disabled={!orderingEnabled || availablePayments.length === 0}
                aria-label={!orderingEnabled ? "Pedidos pausados" : availablePayments.length === 0 ? "Pagamento indisponível" : nextStep ? `Continuar para ${nextStep.label.toLowerCase()}` : "Revisar pedido"}
                className="mt-3.5 flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[var(--km-accent)] px-6 text-xs font-black uppercase tracking-wider text-[var(--km-on-accent)] shadow-md transition hover:bg-[var(--km-accent-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[var(--km-raised)] disabled:text-[var(--km-muted)] cursor-pointer"
                id="btn-confirm-order"
              >
                <span>{!orderingEnabled ? "Pedidos pausados" : availablePayments.length === 0 ? "Pagamento indisponível" : nextStep ? `Continuar para ${nextStep.label.toLowerCase()}` : "Revisar pedido"}</span>
                {orderingEnabled && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
