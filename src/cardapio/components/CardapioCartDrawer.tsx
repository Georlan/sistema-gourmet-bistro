/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFulfillmentAvailability, resolveFulfillmentSelection, type CardapioFulfillment } from "../fulfillment";
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
  Check,
  CheckCircle2,
  Coins,
  DollarSign,
  MapPin,
  Mail,
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
} from "../../domain/deliveryAddress";
import DeliveryAddressFields from "../../components/shared/DeliveryAddressFields";
import { getDeliveryMinimumRemaining, getDeliveryQuote } from "../deliveryPresentation";
import CardapioPaymentOptions from "./CardapioPaymentOptions";
import { getCheckoutPaymentMethods, getPaymentSelectionError, resolvePaymentSelection, type PaymentMethod } from "../paymentMethods";
import { getPairingRecommendations } from "../pairingRecommendations";
import { KomaPrimaryAction } from "./KomaActionPrimitives";

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
}: CardapioCartDrawerProps) {
  const [selectedFulfillment, setSelectedFulfillment] = useState<CardapioFulfillment | null>(initialFulfillment ?? null);
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

  useEffect(() => {
    if (!initialCouponCode.trim()) return;
    setCouponCode(initialCouponCode);
    setAppliedCoupon(null);
    appliedCouponFingerprintRef.current = null;
    setCouponError("");
  }, [initialCouponCode]);

  // Cashback state
  const [useCashback, setUseCashback] = useState(false);

  useEffect(() => {
    setAppliedCoupon(null);
    appliedCouponFingerprintRef.current = null;
    setUseCashback(false);
    setCouponError("");
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
      setGuestName(user.name || "");
      setGuestPhone(formatBrazilianPhone(user.phone || ""));
      setGuestEmail(user.email || "");
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
  const deliveryLabel = deliveryQuote.fee === 0 ? "Sem taxa de entrega" : `Taxa de ${formatPrice(deliveryQuote.fee)}`;
  const minimumOrder = brandConfig?.pedidoMinimo || 0;
  const remainingMinimum = deliveryMethod ? getDeliveryMinimumRemaining(brandConfig, subtotal, deliveryMethod) : 0;
  const freeDeliveryThreshold = brandConfig?.freteGratisValor || 0;

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
    return getPairingRecommendations({
      catalog: allProducts,
      cartProductIds,
      limit: 4,
    });
  }, [allProducts, cart]);

  // Handle Coupon Validation
  const handleApplyCoupon = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!couponsEnabled || !couponCode.trim()) return;
    if (!user && !isCompleteBrazilianPhone(guestPhone)) {
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

      const data = await res.json();
      if (couponFingerprintRef.current !== requestFingerprint) {
        setCouponError("O pedido, celular ou cupom mudou. Confira o cupom novamente.");
        return;
      }
      if (!data.valido) {
        setCouponError(data.mensagem || "Cupom inválido.");
        setAppliedCoupon(null);
      } else {
        appliedCouponFingerprintRef.current = requestFingerprint;
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
    appliedCouponFingerprintRef.current = null;
    setCouponCode("");
    setCouponError("");
  };

  const recognizedExistingCustomer = !user && customerRecognition === "found";
  const customerName = user?.name || (recognizedExistingCustomer ? "Cliente identificado" : guestName);
  const customerPhone = user?.phone || normalizeBrazilianPhone(guestPhone);

  interface CartStepDefinition {
    id: string;
    label: string;
    fullTitle: string;
    sectionId: string;
  }

  const visibleSteps = useMemo(() => {
    const rawSteps: CartStepDefinition[] = [
      { id: "items", label: "Itens", fullTitle: "Seu pedido", sectionId: "cart-items" },
      { id: "delivery", label: "Receber", fullTitle: "Como quer receber?", sectionId: "cart-receive-methods" },
      ...(showDiscounts ? [{ id: "discounts", label: "Descontos", fullTitle: "Descontos & Benefícios", sectionId: "cart-discounts" }] : []),
      { id: "payment", label: "Pagamento", fullTitle: "Como quer pagar?", sectionId: "cart-payment-methods" },
      { id: "contact", label: "Contato", fullTitle: "Seu contato", sectionId: "cart-identification" },
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

  const jumpToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
  };

  const validateSection = (sectionId: string) => {
    if (sectionId === "cart-items" && cart.length === 0) {
      reportValidationError("Sua sacola está vazia.", "cart-items");
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
    if (!validateSection("cart-receive-methods") || !validateSection("cart-payment-methods") || !deliveryMethod) return;

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
    if (paymentDetail === "pix" && !/^\S+@\S+\.\S+$/.test(guestEmail.trim())) {
      reportValidationError("Informe um e-mail válido para gerar o pagamento Pix.", "input-customer-email");
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
      customerEmail: paymentDetail === "pix" ? guestEmail.trim().toLowerCase() : undefined,
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
      className="fixed inset-0 z-[46] flex items-end justify-end bg-black/75 backdrop-blur-sm sm:items-stretch animate-fade-in cursor-pointer"
      id="cart-overlay"
    >
      <div
        className="koma-art-drawer-sheet flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[32px] border border-white/10 shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-[32px] sm:border-y-0 sm:border-r-0 animate-slide-left"
        id="cart-drawer-container"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <h2 className="font-serif text-lg font-black tracking-tight text-koma-foreground">Sua sacola</h2>
              {itemCount > 0 && (
                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-black text-emerald-400">{itemCount}</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-koma-muted">Itens selecionados, entrega e finalização.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="koma-art-glass-btn min-h-[44px] min-w-[44px]"
            aria-label="Fechar sacola"
            id="btn-close-cart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {cart.length > 0 && (
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 px-4 py-2.5 no-scrollbar sm:px-5" aria-label="Partes da sacola">
            {visibleSteps.map((step, index) => {
              const isActive = activeSection === step.sectionId;
              const isCompleted = currentStepIndex > index;
              return (
                <button
                  key={step.sectionId}
                  type="button"
                  aria-label={step.label}
                  aria-expanded={isActive}
                  aria-controls={`${step.sectionId}-content`}
                  onClick={() => navigateToStep(step.sectionId)}
                  className={`koma-art-nav-pill-btn ${
                    isActive ? "is-active" : isCompleted ? "is-completed" : "is-pending"
                  }`}
                >
                  {isCompleted ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{step.label}</span>
                    </span>
                  ) : (
                    <span>{step.stepNumber}. {step.label}</span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {errorMessage && (
          <div className="mx-4 mt-3 flex shrink-0 items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-semibold text-rose-300 sm:mx-5" role="alert" id="cart-checkout-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {cart.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-start p-6 text-center overflow-y-auto no-scrollbar">
            {/* Cloche Illustration */}
            <div className="mt-6 flex flex-col items-center">
              <div className="relative grid h-20 w-20 place-items-center rounded-3xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 shadow-lg shadow-emerald-950/30">
                <svg className="w-10 h-10" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M24 10v4" />
                  <path d="M21 10a3 3 0 1 1 6 0" />
                  <path d="M8 34c0-8.837 7.163-16 16-16s16 7.163 16 16H8z" />
                  <line x1="6" y1="38" x2="42" y2="38" />
                  <line x1="16" y1="28" x2="16.01" y2="28" strokeWidth="3" />
                  <line x1="32" y1="28" x2="32.01" y2="28" strokeWidth="3" />
                </svg>
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-koma-foreground">Sua sacola está vazia</h3>
              <p className="mt-1.5 max-w-[280px] text-xs leading-relaxed text-koma-muted">
                Escolha suas delícias favoritas no cardápio para começar seu pedido gastronômico.
              </p>
            </div>

            {allProducts.length > 0 && (
              <div className="mt-8 w-full text-left">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-400 mb-3">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Destaques da Casa</span>
                </div>
                <div className="space-y-2.5">
                  {allProducts
                    .filter((p) => p.isAvailable !== false)
                    .slice(0, 3)
                    .map((prod) => {
                      const hasModifiers = Boolean(
                        (prod.modifierGroups && prod.modifierGroups.length > 0) ||
                        (prod.modifiers && prod.modifiers.length > 0)
                      );
                      return (
                        <div
                          key={prod.id}
                          className="koma-art-cart-item-card"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={getProductImageUrl(prod.image)}
                              alt={prod.name}
                              className="koma-art-cart-thumb !w-13 !h-13"
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                              }}
                            />
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-koma-foreground truncate">{prod.name}</h4>
                              <span className="font-serif text-xs font-black text-emerald-400">{formatPrice(prod.price)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSuggestedProductAction(prod)}
                            className="flex items-center gap-1 px-3.5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-black shrink-0 transition-all shadow-md shadow-emerald-950/30 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{hasModifiers ? "Montar" : "Adicionar"}</span>
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
              className="mt-8 w-full rounded-full border border-white/15 bg-white/5 hover:bg-white/10 py-3.5 text-xs font-bold text-koma-foreground transition cursor-pointer"
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
              <section id="cart-items" tabIndex={-1}>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3>
                    <button
                      type="button"
                      onClick={() => navigateToStep("cart-items")}
                      aria-expanded={activeSection === "cart-items"}
                      aria-controls="cart-items-content"
                      className="min-h-11 w-full text-left text-xs font-black uppercase tracking-wider text-koma-muted"
                    >
                      {getStepHeading("cart-items", "1. Seu pedido")}
                    </button>
                  </h3>
                  <span className="text-xs font-bold text-koma-subtle">{itemCount} {itemCount === 1 ? "item" : "itens"}</span>
                </div>
                <div id="cart-items-content" hidden={activeSection !== "cart-items"}>
                <div className="space-y-3">
                  {cart.map((item) => {
                    let unitPrice = item.product.price;
                    Object.values(item.selectedOptions).forEach((opts) => {
                      opts.forEach((option) => {
                        unitPrice += option.extraPrice;
                      });
                    });

                    return (
                      <div key={item.id} className="koma-art-cart-item-card" id={`cart-item-${item.id}`}>
                        <img
                          src={getProductImageUrl(item.product.image)}
                          alt={item.product.name}
                          className="koma-art-cart-thumb"
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-koma-foreground">{item.quantity}× {item.product.name}</h4>
                          {item.promotionParts ? (
                            <div className="mt-2 space-y-2 text-xs text-koma-muted">
                              {item.promotionParts.map((part, index) => (
                                <div key={index} className="rounded-xl border border-white/10 p-2 bg-white/[0.02]">
                                  <strong className="text-koma-foreground">{part.product.name}</strong>
                                  <p>{Object.values(part.selectedOptions).flat().map(option => option.name).join(', ') || 'Sem adicionais'}</p>
                                  {part.notes && <p>Obs.: {part.notes}</p>}
                                </div>
                              ))}
                            </div>
                          ) : <OrderItemComposition item={cardapioCompositionSource(item)} className="mt-1 text-koma-muted text-xs" />}
                          {onEditItem && <button type="button" onClick={() => onEditItem(item)} className="mt-2 min-h-11 text-xs font-bold text-emerald-400 hover:text-emerald-300" aria-label={`Editar montagem de ${item.product.name}`}>Editar montagem</button>}
                          {onComposeAnother && !item.promotionId && Boolean(item.product.modifiers?.length || item.product.modifierGroups?.length) && <button type="button" onClick={() => onComposeAnother(item)} className="mt-2 block min-h-11 text-xs font-bold text-emerald-400 hover:text-emerald-300" aria-label={`Montar outra diferente de ${item.product.name}`}>Montar outra diferente</button>}
                          {item.notes && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-amber-400">Obs.: {item.notes}</p>}
                          {item.quantity > 1 && <p className="mt-1 text-xs text-koma-muted">{formatPrice(unitPrice)} cada · Mesma montagem</p>}
                          <strong className="mt-2 block font-serif text-sm font-black text-emerald-400">{formatPrice(unitPrice * item.quantity)}</strong>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2.5">
                          <button type="button" onClick={() => onRemoveItem(item.id)} className="grid h-8 w-8 place-items-center rounded-xl text-koma-muted transition hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer" aria-label={`Remover ${item.product.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                          {!item.promotionId && <div className="koma-art-stepper-pill">
                            <button type="button" onClick={() => onUpdateQty(item.id, item.quantity - 1)} className="koma-art-stepper-btn !w-7 !h-7 hover:text-rose-400" aria-label={`Diminuir ${item.product.name}`}>
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="koma-art-stepper-val !min-w-[24px] !text-xs">{item.quantity}</span>
                            <button type="button" onClick={() => onUpdateQty(item.id, item.quantity + 1)} className="koma-art-stepper-btn !w-7 !h-7 hover:text-emerald-400" aria-label={`Aumentar ${item.product.name}`}>
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

              {/* Upselling / Cross-selling Carousel */}
              {activeSection === "cart-items" && upsellSuggestions.length > 0 && onAddToCart && (
                <section className="border-t border-white/10 pt-4">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Uma bebida ou sobremesa para acompanhar?</h3>
                  </div>
                  <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
                    {upsellSuggestions.map((prod) => (
                      <div
                        key={prod.id}
                        className="min-w-[145px] max-w-[145px] bg-white/[0.03] border border-white/10 rounded-2xl p-2.5 flex flex-col justify-between shrink-0"
                      >
                        <img
                          src={getProductImageUrl(prod.image)}
                          alt={prod.name}
                          className="h-18 w-full rounded-xl object-cover mb-2"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div>
                          <h4 className="text-xs font-bold text-koma-foreground line-clamp-1">{prod.name}</h4>
                          <span className="font-serif text-xs font-black text-emerald-400 block mt-0.5">{formatPrice(prod.price)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSuggestedProductAction(prod)}
                          className="mt-2.5 w-full py-1.5 px-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 rounded-full text-[10px] font-black flex items-center justify-center gap-1 transition cursor-pointer"
                        >
                          <Plus className="w-3 h-3" /> Adicionar
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 2: Delivery Method & Address */}
              <section className="border-t border-white/10 pt-5" id="cart-receive-methods" tabIndex={-1} aria-describedby={invalidField === "cart-receive-methods" ? "cart-checkout-error" : undefined}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-receive-methods")}
                    aria-expanded={activeSection === "cart-receive-methods"}
                    aria-controls="cart-receive-methods-content"
                    className="min-h-11 w-full text-left text-xs font-black uppercase tracking-wider text-koma-muted"
                  >
                    {getStepHeading("cart-receive-methods", "2. Como quer receber?")}
                  </button>
                </h3>
                <div id="cart-receive-methods-content" hidden={activeSection !== "cart-receive-methods"}>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" disabled={!pickupEnabled} aria-pressed={deliveryMethod === "pickup"} onClick={() => { if (pickupEnabled) setDeliveryMethod("pickup"); clearValidation("cart-receive-methods"); }} className={`koma-art-mode-card ${deliveryMethod === "pickup" ? "is-selected" : ""} disabled:cursor-not-allowed disabled:opacity-50`}>
                    <span className="flex items-center justify-between gap-1"><ShoppingBag className={deliveryMethod === "pickup" ? "h-5 w-5 text-emerald-400" : "h-5 w-5 text-koma-muted"} />{deliveryMethod === "pickup" && <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />}</span>
                    <strong className="mt-2 block text-xs font-black text-koma-foreground sm:text-sm">Retirada</strong>
                    <span className="mt-1 block text-[10px] leading-relaxed text-koma-muted">{pickupEnabled ? "Buscar no restaurante" : "Indisponível no momento"}</span>
                  </button>
                  <button type="button" disabled={!dineInEnabled} aria-pressed={deliveryMethod === "dine_in"} onClick={() => { if (dineInEnabled) setDeliveryMethod("dine_in"); clearValidation("cart-receive-methods"); }} className={`koma-art-mode-card ${deliveryMethod === "dine_in" ? "is-selected" : ""} disabled:cursor-not-allowed disabled:opacity-50`}>
                    <span className="flex items-center justify-between gap-1"><Store className={deliveryMethod === "dine_in" ? "h-5 w-5 text-emerald-400" : "h-5 w-5 text-koma-muted"} />{deliveryMethod === "dine_in" && <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />}</span>
                    <strong className="mt-2 block text-xs font-black text-koma-foreground sm:text-sm">Consumo local</strong>
                    <span className="mt-1 block text-[10px] leading-relaxed text-koma-muted">{dineInEnabled ? "Comer no restaurante" : "Indisponível no momento"}</span>
                  </button>
                  <button type="button" disabled={!deliveryEnabled} aria-pressed={deliveryMethod === "delivery"} onClick={() => { if (deliveryEnabled) setDeliveryMethod("delivery"); clearValidation("cart-receive-methods"); }} className={`koma-art-mode-card ${deliveryMethod === "delivery" ? "is-selected" : ""} disabled:cursor-not-allowed disabled:opacity-50`}>
                    <span className="flex items-center justify-between gap-1"><Truck className={deliveryMethod === "delivery" ? "h-5 w-5 text-emerald-400" : "h-5 w-5 text-koma-muted"} />{deliveryMethod === "delivery" && <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />}</span>
                    <strong className="mt-2 block text-xs font-black text-koma-foreground sm:text-sm">Entrega</strong>
                    <span className="mt-1 block text-[10px] leading-relaxed text-koma-muted">{deliveryEnabled ? deliveryLabel : "Indisponível no momento"}</span>
                  </button>
                </div>

                {deliveryMethod === "dine_in" && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
                    <Store className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div className="min-w-0 text-xs leading-relaxed">
                      <strong className="text-koma-foreground font-bold">Para consumir no local</strong>
                      <p className="mt-1 text-koma-muted">Você pode pedir antes de chegar. O restaurante pode associar seu pedido a uma mesa depois.</p>
                      {restaurantAddress && <p className="mt-1 break-words text-koma-subtle text-[11px]">{restaurantAddress}</p>}
                    </div>
                  </div>
                )}

                {deliveryMethod === "pickup" && restaurantAddress && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div className="min-w-0 text-xs leading-relaxed"><strong className="text-koma-foreground font-bold">Local de retirada</strong><p className="mt-1 break-words text-koma-muted text-[11px]">{restaurantAddress}</p></div>
                  </div>
                )}

                {deliveryMethod === "delivery" && (
                  <div className="mt-3 space-y-3">
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
                      neighborhoodOptions={(brandConfig?.tabelaTaxasBairros || []).map((item) => ({
                        value: item.bairro,
                        label: `${item.bairro} (${item.taxa === 0 ? "Grátis" : formatPrice(item.taxa)})`,
                      }))}
                      legacyHint={legacyAddressHint}
                      idPrefix="delivery-address"
                    />
                    <p className="break-words text-xs leading-relaxed text-koma-muted" aria-live="polite">
                      {selectedBairro
                        ? (brandConfig?.tabelaTaxasBairros || []).some((item) => item.bairro.toLowerCase() === selectedBairro.trim().toLowerCase())
                          ? `${selectedBairro}: taxa de ${formatPrice(deliveryQuote.fee)} incluída no resumo.`
                          : `${selectedBairro}: taxa padrão de ${formatPrice(deliveryQuote.fee)} incluída no resumo.`
                        : deliveryQuote.fee === 0
                          ? "Sem taxa de entrega neste pedido."
                          : `Taxa padrão de ${formatPrice(deliveryQuote.fee)} incluída no resumo.`}
                    </p>
                  </div>
                )}

                  <button type="button" onClick={() => nextSection && continueToSection(nextSection)} className="mt-4 min-h-12 w-full rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-4 text-xs font-black uppercase tracking-wider text-emerald-400 transition-all cursor-pointer">
                    {nextStep ? `Continuar para ${nextStep.label.toLowerCase()}` : "Continuar"}
                  </button>
                </div>
              </section>

              {/* Section 3: Cupons & Descontos */}
              {showDiscounts && <section className="border-t border-white/10 pt-5" id="cart-discounts" tabIndex={-1}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-discounts")}
                    aria-expanded={activeSection === "cart-discounts"}
                    aria-controls="cart-discounts-content"
                    className="min-h-11 w-full text-left text-xs font-black uppercase tracking-wider text-koma-muted"
                  >
                    {getStepHeading("cart-discounts", "3. Descontos & Benefícios")}
                  </button>
                </h3>
                <div id="cart-discounts-content" hidden={activeSection !== "cart-discounts"}>

                {/* Coupon Box */}
                {couponsEnabled && (appliedCoupon ? (
                  <div className="flex items-center justify-between p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-xs">
                    <div className="flex items-center gap-2.5">
                      <Ticket className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <span className="font-mono font-bold text-emerald-300">{appliedCoupon.codigo}</span>
                        <p className="text-[10px] text-emerald-400/80 mt-0.5">{appliedCoupon.mensagem} (- {formatPrice(appliedCoupon.desconto)})</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="p-1 text-koma-muted hover:text-rose-400 rounded-lg cursor-pointer"
                      title="Remover cupom"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleApplyCoupon} className="flex gap-2">
                    <div className="relative flex-1">
                      <Ticket className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-koma-muted" />
                      <input
                        type="text"
                        placeholder="Código do cupom..."
                        value={couponCode}
                        onChange={(e) => {
                          setCouponCode(e.target.value.toUpperCase());
                          setCouponError("");
                        }}
                        aria-label="Código do cupom"
                        className="min-h-12 w-full pl-10 pr-3 py-2 bg-white/[0.03] border border-white/10 rounded-2xl text-base sm:text-xs font-mono font-bold uppercase text-koma-foreground placeholder:normal-case placeholder:font-normal focus:outline-none focus:border-emerald-500 tracking-wider"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={validatingCoupon || !couponCode.trim()}
                      className="px-5 py-2 bg-white/5 hover:bg-emerald-500 hover:text-white border border-white/10 rounded-2xl text-xs font-bold text-koma-foreground transition-all disabled:opacity-40 cursor-pointer"
                    >
                      {validatingCoupon ? "..." : "Aplicar"}
                    </button>
                  </form>
                ))}
                {couponsEnabled && couponError && (
                  <p className="text-[10px] text-rose-400 font-semibold mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {couponError}
                  </p>
                )}

                {/* Cashback Toggle (if user has balance) */}
                {userCashbackBalance > 0 && (
                  <div className="mt-3 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
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

                  <button
                    type="button"
                    onClick={() => nextSection && continueToSection(nextSection)}
                    className="mt-4 min-h-12 w-full rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-4 text-xs font-black uppercase tracking-wider text-emerald-400 transition-all cursor-pointer"
                  >
                    {nextStep ? `Continuar para ${nextStep.label.toLowerCase()}` : "Continuar"}
                  </button>
                </div>
              </section>}

              {/* Section 4: Forma de Pagamento & Troco */}
              <section className="border-t border-white/10 pt-5" id="cart-payment-methods" tabIndex={-1} aria-describedby={invalidField === "cart-payment-methods" ? "cart-checkout-error" : undefined}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-payment-methods")}
                    aria-expanded={activeSection === "cart-payment-methods"}
                    aria-controls="cart-payment-methods-content"
                    className="min-h-11 w-full text-left text-xs font-black uppercase tracking-wider text-koma-muted"
                  >
                    {getStepHeading("cart-payment-methods", "Como quer pagar?")}
                  </button>
                </h3>
                <div id="cart-payment-methods-content" hidden={activeSection !== "cart-payment-methods"}>
                <p className="mt-2 mb-3 text-xs leading-relaxed text-koma-muted">{availablePayments.includes("pix") && "Pix é pago agora e só libera o pedido após confirmação. "}{availablePayments.some(method => method !== "pix") && <>Nas opções presenciais, você paga {deliveryMethod === "delivery" ? "na entrega" : deliveryMethod === "dine_in" ? "no restaurante" : "na retirada"}.</>}</p>

                <CardapioPaymentOptions available={availablePayments} selected={paymentDetail} onSelect={selectPayment} />

                {/* Troco Calculator for Dinheiro */}
                {paymentDetail === "dinheiro" && (
                  <div className="mt-3.5 p-3.5 bg-white/[0.03] border border-white/10 rounded-2xl space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-koma-foreground">Precisa de troco?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-pressed={!precisaTroco}
                          onClick={() => setPrecisaTroco(false)}
                          className={`min-h-10 min-w-11 px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${!precisaTroco ? 'bg-emerald-500 text-white shadow-md shadow-emerald-950/30' : 'bg-white/5 border border-white/10 text-koma-muted'}`}
                        >
                          Não
                        </button>
                        <button
                          type="button"
                          aria-pressed={precisaTroco}
                          onClick={() => setPrecisaTroco(true)}
                          className={`min-h-10 min-w-11 px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${precisaTroco ? 'bg-emerald-500 text-white shadow-md shadow-emerald-950/30' : 'bg-white/5 border border-white/10 text-koma-muted'}`}
                        >
                          Sim
                        </button>
                      </div>
                    </div>

                    {precisaTroco && (
                      <div className="space-y-2.5 pt-2.5 border-t border-white/10">
                        <label htmlFor="payment-change-for" className="block text-xs font-semibold text-koma-foreground">Vai pagar com quanto?</label>
                        <div className="flex gap-2">
                          {[50, 100, 200].map((val) => (
                            <button
                              key={val}
                              type="button"
                              aria-pressed={trocoPara === String(val)}
                              onClick={() => setTrocoPara(String(val))}
                              className={`min-h-11 min-w-0 flex-1 py-2 rounded-xl border text-xs font-mono font-bold transition cursor-pointer ${
                                trocoPara === String(val)
                                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                                  : "border-white/10 bg-white/5 text-koma-muted hover:bg-white/10"
                              }`}
                            >
                              R$ {val}
                            </button>
                          ))}
                        </div>
                        <div className="relative mt-2">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-koma-muted">R$</span>
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
                            className={`min-h-12 w-full pl-10 pr-3 py-2 bg-white/[0.03] border rounded-2xl text-base font-mono font-bold text-koma-foreground outline-none focus:border-emerald-500 ${invalidField === "payment-change-for" ? "border-rose-500" : "border-white/10"}`}
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

                  <button
                    type="button"
                    onClick={() => nextSection && continueToSection(nextSection)}
                    className="mt-4 min-h-12 w-full rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-4 text-xs font-black uppercase tracking-wider text-emerald-400 transition-all cursor-pointer"
                  >
                    {nextStep ? `Continuar para ${nextStep.label.toLowerCase()}` : "Continuar"}
                  </button>
                </div>
              </section>

              {/* Section 5: Identification */}
              <section className="border-t border-white/10 pt-5" id="cart-identification" tabIndex={-1}>
                <h3>
                  <button
                    type="button"
                    onClick={() => navigateToStep("cart-identification")}
                    aria-expanded={activeSection === "cart-identification"}
                    aria-controls="cart-identification-content"
                    className="min-h-11 w-full text-left text-xs font-black uppercase tracking-wider text-koma-muted"
                  >
                    {getStepHeading("cart-identification", "Seu contato")}
                  </button>
                </h3>
                <div id="cart-identification-content" hidden={activeSection !== "cart-identification"}>
                {user ? (
                  <div className="mt-3 flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div>
                      <p className="text-xs font-black text-koma-foreground">{user.name}</p>
                      <p className="mt-0.5 text-[10px] text-koma-muted">{formatBrazilianPhone(user.phone || "")} · cliente identificado</p>
                    </div>
                  </div>
                ) : accountRequired ? (
                  <div className="mt-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5">
                    <p className="text-xs font-black text-koma-foreground">Conta necessária para pedir</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                      Entre ou crie sua conta. No cadastro novo, confirme o link enviado ao seu e-mail antes de continuar.
                    </p>
                    {onAuthClick && (
                      <button
                        type="button"
                        onClick={onAuthClick}
                        className="mt-3 min-h-11 w-full rounded-full bg-emerald-500 px-4 text-xs font-black text-white transition hover:bg-emerald-600 cursor-pointer"
                      >
                        Entrar ou criar conta
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Celular com DDD</span>
                      <span className="relative block"><Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="tel" inputMode="numeric" autoComplete="tel" placeholder="(00) 00000-0000" value={guestPhone} onChange={(event) => { setGuestPhone(formatBrazilianPhone(event.target.value)); clearValidation("input-guest-phone"); }} aria-invalid={invalidField === "input-guest-phone"} aria-describedby={invalidField === "input-guest-phone" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-2xl border bg-white/[0.03] pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-stone-500 focus:border-emerald-500 ${invalidField === "input-guest-phone" ? "border-rose-500" : "border-white/10"}`} id="input-guest-phone" /></span>
                    </label>
                    <p className="text-xs leading-relaxed text-koma-muted">Usamos seu celular para identificar o pedido e permitir que o restaurante entre em contato se precisar.</p>
                    {customerRecognition === "checking" && (
                      <p className="text-[10px] font-semibold text-koma-muted" role="status">Conferindo seu celular...</p>
                    )}
                    {customerRecognition === "found" && (
                      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-2.5" role="status">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        <p className="text-[10px] font-semibold leading-relaxed text-emerald-300">Reconhecemos seu celular. Você pode continuar sem informar seu nome novamente.</p>
                      </div>
                    )}
                    {customerRecognition === "new" && (
                      <p className="text-[10px] font-semibold leading-relaxed text-koma-muted" role="status">Primeiro pedido com este celular? Informe seu nome abaixo.</p>
                    )}
                    {customerRecognition !== "found" && (
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Seu nome</span>
                        <span className="relative block"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="text" autoComplete="name" maxLength={100} placeholder="Como devemos chamar você?" value={guestName} onChange={(event) => { setGuestName(event.target.value); clearValidation("input-guest-name"); }} aria-invalid={invalidField === "input-guest-name"} aria-describedby={invalidField === "input-guest-name" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-2xl border bg-white/[0.03] pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-stone-500 focus:border-emerald-500 ${invalidField === "input-guest-name" ? "border-rose-500" : "border-white/10"}`} id="input-guest-name" /></span>
                      </label>
                    )}
                    {onAuthClick && <button type="button" onClick={onAuthClick} className="text-left text-xs font-semibold leading-relaxed text-koma-muted transition hover:text-emerald-400">{brandConfig?.benefits?.loyalty ? "Quer acompanhar seus benefícios? " : "Já tem cadastro? "}<strong className="text-emerald-400">Entrar na conta.</strong></button>}
                  </div>
                )}
                {paymentDetail === "pix" && brandConfig?.pixPayerDocumentRequired && (
                  <label className="mt-3 block text-xs text-koma-muted">CPF ou CNPJ do comprador
                    <input id="input-customer-document" inputMode="numeric" autoComplete="off" maxLength={14}
                      value={guestDocument} onChange={event => { setGuestDocument(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); clearValidation("input-customer-document"); }}
                      aria-invalid={invalidField === "input-customer-document"}
                      className="mt-1 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm text-koma-foreground outline-none focus:border-emerald-500" />
                    <span className="mt-1 block">O PagBank exige o documento para emitir o Pix deste pedido.</span>
                  </label>
                )}
                {paymentDetail === "pix" && (
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">E-mail para o Pix</span>
                    <span className="relative block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="email" autoComplete="email" maxLength={254} placeholder="voce@exemplo.com" value={guestEmail} onChange={(event) => { setGuestEmail(event.target.value); clearValidation("input-customer-email"); }} aria-invalid={invalidField === "input-customer-email"} aria-describedby={invalidField === "input-customer-email" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-2xl border bg-white/[0.03] pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-stone-500 focus:border-emerald-500 ${invalidField === "input-customer-email" ? "border-rose-500" : "border-white/10"}`} id="input-customer-email" /></span>
                  </label>
                )}
                </div>
              </section>

            </div>

            {/* Footer Summary & Action */}
            <div className="shrink-0 border-t border-white/10 bg-black/40 backdrop-blur-md p-4 sm:p-5">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-koma-muted"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-koma-muted">
                    <span>Taxa de entrega</span>
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
                <div className="flex justify-between border-t border-white/10 pt-2 text-sm font-black text-koma-foreground">
                  <span>Total estimado</span>
                  <span className="font-serif text-lg font-black text-emerald-400">{formatPrice(total)}</span>
                </div>
              </div>
              {remainingMinimum > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-amber-400" role="status">Faltam <strong>{formatPrice(remainingMinimum)}</strong> em produtos para o pedido mínimo de {formatPrice(minimumOrder)}.</p>
              )}
              <button
                type="button"
                onClick={() => nextSection ? continueToSection(nextSection) : handleCheckout()}
                disabled={!orderingEnabled || availablePayments.length === 0}
                aria-label={!orderingEnabled ? "Pedidos pausados" : availablePayments.length === 0 ? "Pagamento indisponível" : nextSection ? "Continuar" : "Revisar pedido"}
                className="mt-4 koma-action-primary flex h-13 w-full items-center justify-between gap-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-6 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-950/40 transition hover:from-emerald-400 hover:to-teal-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-stone-500 cursor-pointer"
                id="btn-confirm-order"
              >
                <span className="flex items-center gap-2">
                  <span>{!orderingEnabled ? "Pedidos pausados" : availablePayments.length === 0 ? "Pagamento indisponível" : nextSection ? "Continuar" : "Revisar pedido"}</span>
                  {orderingEnabled && <ArrowRight className="h-4 w-4" />}
                </span>
                <span className="shrink-0 rounded-full bg-black/20 px-2.5 py-1 font-mono text-xs font-black text-emerald-100">
                  {formatPrice(total)}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
