import "../accountInvitation.css";
import PixCopyCode from "./PixCopyCode";
import { DirectPixCustomerConfirm } from "./DirectPixCustomerConfirm";
import { OrderItemComposition } from "../../components/shared/OrderItemComposition";
import { cardapioCompositionSource } from "../orderItems";
import { QRCodeSVG } from 'qrcode.react';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bike,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  MapPin,
  MessageCircle,
  QrCode,
  Send,
  ShoppingBag,
  Sparkles,
  Store,
  UserRound,
  X,
} from "lucide-react";
import { BrandConfig } from "../CardapioTypes";
import { CartItem, type CardapioFulfillment } from "./CardapioCartDrawer";
import { API_BASE_URL } from "../../config/api";
import { openWhatsAppMessage, buildPedidoConfirmadoMsg } from "../../config/whatsappUtils";
import type { DeliveryAddressSnapshot } from "../../domain/deliveryAddress";
import { createSecureIdempotencyKey } from "../../utils/secureIdempotency";
import { authRequestErrorMessage } from "../../utils/authRequest";
import { formatCardapioApiError } from "../orderApiErrors";
import { saveStoredOrder } from "../orderTracking";
import { buildCardapioOrderItems, buildCardapioPromotionItemIndices } from "../orderItems";
import { findOutdatedCartProducts } from "../cartCatalogConsistency";
import { isOrderingBlockConflict } from "../orderingBlockUi";
import CardapioPaymentSummary from "./CardapioPaymentSummary";
import {
  KomaAccountInviteAsset,
  KomaBagAsset,
  KomaDeliveryAsset,
  KomaDineInAsset,
  KomaOrderStatusAsset,
  KomaPickupAsset,
} from "../v2/KomaVisualAssets";
import { getCheckoutPaymentMethods, getPaymentSelectionError, PAYMENT_LABELS } from "../paymentMethods";
import { isLocalOrderSimulation } from "../devSimulation";
import {
  buildOrderSubmissionFingerprint,
  normalizePendingOrderSubmissions,
  resolveOrderSubmissionKey,
  upsertPendingOrderSubmission,
} from "../orderSubmission";
import { trackAnalyticsEvent } from "../../analytics";
import { fetchWithInlineSupport } from "../../utils/supportCode";
import { startPaymentStatusPolling } from "../paymentStatusPolling";

import { createCheckoutDiagnostics, type CheckoutOutcome } from "../../analytics/checkoutDiagnostic";

const beginCheckoutDiagnostic = createCheckoutDiagnostics(signal => trackAnalyticsEvent('public_checkout_result', signal));

interface CreatedOrder {
  comanda_id: string;
  numero_pedido: string | number;
  total?: number;
  fulfillment?: CardapioFulfillment;
  delivery_address?: string;
  pagamento?: OnlinePaymentResponse;
  scheduled_for?: string | null;
  tracking_token?: string;
  tracking_url?: string;
}

interface OnlinePaymentResponse {
  status: string;
  cobranca_online: boolean;
  provedor?: string;
  metodo?: string;
  txid?: string | null;
  cliente_informou_pagamento?: boolean;
  preparo_liberado_sem_confirmacao?: boolean;
  pagamento_informado_em?: string | null;
  qr_code?: string | null;
  qr_code_base64?: string | null;
  confirmacao_manual?: boolean;
  ticket_url?: string | null;
  expira_em?: string | null;
}

interface CardapioDigitalProps {
  activeBrand: BrandConfig;
  cart: CartItem[];
  deliveryFee: number;
  deliveryMethod: CardapioFulfillment;
  address: string;
  addressSnapshot?: DeliveryAddressSnapshot | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerDocument?: string;
  customerToken?: string | null;
  paymentMethodDetail?: "dinheiro" | "pix" | "cartao_credito" | "cartao_debito";
  trocoPara?: number;
  bairro?: string;
  cupomCodigo?: string;
  descontoCupom?: number;
  usarCashback?: boolean;
  descontoCashback?: number;
  onClose: () => void;
  onEditCart?: () => void;
  onOrderCreated?: (order: CreatedOrder) => void;
  onOrderSuccess: (order: CreatedOrder) => void;
  onCreateAccount?: () => void;
  onSessionExpired?: () => void;
  isLocalSimulation?: boolean;
}


const PENDING_ORDER_STORAGE_KEY = "koma_pending_order_submission";
const PENDING_ORDER_TTL_MS = 15 * 60 * 1000;
const ORDER_REQUEST_TIMEOUT_MS = 15_000;
const SCHEDULE_MIN_LEAD_MS = 30 * 60 * 1000;
const SCHEDULE_MAX_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

const createIdempotencyKey = () => createSecureIdempotencyKey("order");

const formatPrice = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(value);

const toLocalDateTimeInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const formatScheduledDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const publicFulfillmentValue = (fulfillment: CardapioFulfillment) => {
  if (fulfillment === "delivery") return "delivery";
  if (fulfillment === "dine_in") return "consumo_local";
  return "retirada";
};

const storedFulfillmentLabel = (fulfillment: CardapioFulfillment) => {
  if (fulfillment === "delivery") return "Delivery";
  if (fulfillment === "dine_in") return "Consumo no Local";
  return "Retirada";
};

const checkoutFulfillmentLabel = (fulfillment: CardapioFulfillment) => {
  if (fulfillment === "delivery") return "Entrega";
  if (fulfillment === "dine_in") return "Consumo local";
  return "Retirada";
};

export default function CardapioDigital({
  activeBrand,
  cart,
  deliveryFee,
  deliveryMethod,
  address,
  addressSnapshot,
  customerName,
  customerPhone,
  customerEmail,
  customerDocument,
  customerToken,
  paymentMethodDetail,
  trocoPara,
  bairro,
  cupomCodigo,
  descontoCupom = 0,
  usarCashback = false,
  descontoCashback = 0,
  onClose,
  onEditCart,
  onOrderCreated,
  onOrderSuccess,
  onSessionExpired,
  onCreateAccount,
  isLocalSimulation: isLocalSimulationProp,
}: CardapioDigitalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [supportCode, setSupportCode] = useState("");
  const [supportCopied, setSupportCopied] = useState(false);
  const [requiresCartReview, setRequiresCartReview] = useState(false);
  const [canCorrectSubmission, setCanCorrectSubmission] = useState(true);
  const [orderingBlocked, setOrderingBlocked] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const customerWhatsAppStatusEnabled = activeBrand.customerWhatsAppStatusEnabled === true;
  const [whatsappStatusOptIn, setWhatsappStatusOptIn] = useState(false);
  const [scheduledOrdersEnabled, setScheduledOrdersEnabled] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>("");
  const idempotencyFingerprintRef = useRef<string | null>(null);

  const subtotal = useMemo(() => cart.reduce((acc, item) => {
    let unitPrice = item.product.price;
    Object.values(item.selectedOptions).forEach((options) => {
      options.forEach((option) => {
        unitPrice += option.extraPrice;
      });
    });
    return acc + unitPrice * item.quantity;
  }, 0), [cart]);

  const estimatedTotal = Math.max(0, subtotal + deliveryFee - descontoCupom - descontoCashback);
  const availablePayments = useMemo(
    () => getCheckoutPaymentMethods(activeBrand.paymentMethods, activeBrand.onlinePaymentEnabled),
    [activeBrand.onlinePaymentEnabled, activeBrand.paymentMethods],
  );
  const paymentError = getPaymentSelectionError(paymentMethodDetail, availablePayments);
  const schedulePaymentError = scheduleMode === "scheduled" && paymentMethodDetail === "pix"
    ? "Pedidos agendados usam pagamento no atendimento nesta versão. Selecione dinheiro ou cartão."
    : "";

  const scheduleMin = toLocalDateTimeInput(new Date(Date.now() + SCHEDULE_MIN_LEAD_MS));
  const scheduleMax = toLocalDateTimeInput(new Date(Date.now() + SCHEDULE_MAX_HORIZON_MS));

  useEffect(() => {
    const restauranteId = Number(activeBrand.id);
    if (!Number.isInteger(restauranteId) || restauranteId <= 0) {
      setScheduledOrdersEnabled(false);
      setScheduleMode("now");
      return;
    }

    let cancelled = false;
    const loadFeature = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/restaurant-features/public/scheduled-orders?restaurante_id=${restauranteId}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => null);
        const enabled = response.ok && data?.enabled === true;
        if (cancelled) return;
        setScheduledOrdersEnabled(enabled);
        if (!enabled) {
          setScheduleMode("now");
          setScheduledFor("");
        }
      } catch {
        if (!cancelled) {
          setScheduledOrdersEnabled(false);
          setScheduleMode("now");
          setScheduledFor("");
        }
      }
    };
    void loadFeature();
    return () => {
      cancelled = true;
    };
  }, [activeBrand.id]);

  const resolvePersistentIdempotencyKey = (fingerprint: string) => {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      const submissions = normalizePendingOrderSubmissions(
        raw ? JSON.parse(raw) : null,
        now,
        PENDING_ORDER_TTL_MS,
      );
      const pending = submissions.find((item) => item.fingerprint === fingerprint) ?? null;

      const key = resolveOrderSubmissionKey({
        fingerprint,
        now,
        ttlMs: PENDING_ORDER_TTL_MS,
        pending,
        currentKey: "",
        currentFingerprint: null,
        createKey: createIdempotencyKey,
      });
      const nextSubmissions = upsertPendingOrderSubmission(submissions, {
        key,
        fingerprint,
        createdAt: now,
      }, now, PENDING_ORDER_TTL_MS);
      localStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify({
        submissions: nextSubmissions,
      }));
      idempotencyKeyRef.current = key;
      idempotencyFingerprintRef.current = fingerprint;
      return key;
    } catch (error) {
      console.warn("Não foi possível persistir a tentativa do pedido:", error);
      const key = resolveOrderSubmissionKey({
        fingerprint,
        now: Date.now(),
        ttlMs: PENDING_ORDER_TTL_MS,
        pending: null,
        currentKey: idempotencyKeyRef.current,
        currentFingerprint: idempotencyFingerprintRef.current,
        createKey: createIdempotencyKey,
      });
      idempotencyKeyRef.current = key;
      idempotencyFingerprintRef.current = fingerprint;
      return key;
    }
  };

  const clearPendingSubmission = (key: string) => {
    try {
      const raw = localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      if (!raw) return;
      const submissions = normalizePendingOrderSubmissions(
        JSON.parse(raw),
        Date.now(),
        PENDING_ORDER_TTL_MS,
      ).filter((submission) => submission.key !== key);
      if (submissions.length === 0) {
        localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      } else {
        localStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify({ submissions }));
      }
    } catch (error) {
      console.warn("Não foi possível limpar a tentativa confirmada:", error);
    }
  };

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;
    setSupportCode("");
    setSupportCopied(false);
    if (paymentError || schedulePaymentError) {
      setErrorMessage(paymentError || schedulePaymentError);
      return;
    }

    const targetRestauranteId = Number(activeBrand.id);
    const normalizedPhone = customerPhone.replace(/\D/g, "");
    const normalizedName = customerName.trim();
    const normalizedAddress = address.trim();
    let scheduledForIso: string | undefined;

    if (!Number.isInteger(targetRestauranteId) || targetRestauranteId <= 0) {
      setErrorMessage("Não foi possível identificar o restaurante. Reabra o cardápio pelo link oficial.");
      return;
    }
    if (!normalizedName || normalizedName.length < 2) {
      setErrorMessage("Informe um nome válido antes de enviar o pedido.");
      return;
    }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      setErrorMessage("Informe um telefone válido com DDD antes de enviar o pedido.");
      return;
    }
    if (deliveryMethod === "delivery" && normalizedAddress.length < 5) {
      setErrorMessage("Informe o endereço completo de entrega.");
      return;
    }
    if (cart.length === 0) {
      setErrorMessage("Sua sacola está vazia.");
      return;
    }
    if (cart.some(item => item.promotionId) && (cupomCodigo?.trim() || usarCashback)) {
      setErrorMessage("Esta promoção não é cumulativa com cupom ou cashback. Volte à sacola e retire o benefício.");
      return;
    }
    const uniquePromotionIds = new Set(cart.map(item => item.promotionId).filter(Boolean));
    if (uniquePromotionIds.size > 1) {
      setErrorMessage("Escolha apenas uma promoção por pedido.");
      return;
    }
    if (scheduleMode === "scheduled") {
      if (!scheduledOrdersEnabled) {
        setErrorMessage("Este restaurante não está aceitando pedidos agendados.");
        return;
      }
      const target = new Date(scheduledFor);
      const targetMs = target.getTime();
      if (!scheduledFor || Number.isNaN(targetMs)) {
        setErrorMessage("Escolha a data e o horário do pedido.");
        return;
      }
      if (targetMs < Date.now() + SCHEDULE_MIN_LEAD_MS - 60_000) {
        setErrorMessage("Escolha um horário com pelo menos 30 minutos de antecedência.");
        return;
      }
      if (targetMs > Date.now() + SCHEDULE_MAX_HORIZON_MS + 60_000) {
        setErrorMessage("O pedido pode ser agendado com no máximo 7 dias de antecedência.");
        return;
      }
      scheduledForIso = target.toISOString();
    }

    // Mesa não é inferida pelo Cardápio Online. Consumo local nasce sem mesa
    // e pode receber uma associação operacional depois, no Caixa.
    const cleanedItems = buildCardapioOrderItems(cart, normalizedName);

    const orderRequest = {
      restaurante_id: targetRestauranteId,
      itens: cleanedItems,
      promocao_item_indices: activeBrand.explicitPromotionComposition ? buildCardapioPromotionItemIndices(cart) : undefined,
      promocao_id: cart.find(item => item.promotionId)?.promotionId || undefined,
      promocao_preco_esperado: cart.find(item => item.promotionId)?.product.price,
      cliente_nome: normalizedName,
      cliente_telefone: normalizedPhone,
      whatsapp_status_opt_in: customerWhatsAppStatusEnabled && deliveryMethod !== "dine_in" && whatsappStatusOptIn,
      endereco_entrega: deliveryMethod === "delivery" ? normalizedAddress : "",
      address_snapshot: deliveryMethod === "delivery" ? addressSnapshot || undefined : undefined,
      taxa_entrega: deliveryMethod === "delivery" ? deliveryFee : 0,
      forma_pagamento: paymentMethodDetail === "pix" ? "online" : "na_entrega",
      forma_pagamento_detalhe: paymentMethodDetail,
      cliente_documento: paymentMethodDetail === "pix" ? customerDocument : undefined,
      cliente_email: paymentMethodDetail === "pix" ? customerEmail?.trim().toLowerCase() : undefined,
      troco_para: paymentMethodDetail === "dinheiro" ? trocoPara : undefined,
      bairro: deliveryMethod === "delivery" ? bairro?.trim() || undefined : undefined,
      cupom_codigo: cupomCodigo?.trim().toUpperCase() || undefined,
      usar_cashback: usarCashback,
      tipo_pedido: publicFulfillmentValue(deliveryMethod),
      scheduled_for: scheduledForIso || null,
    };
    // A consent choice changed after a timeout must not create a second order.
    const fingerprint = buildOrderSubmissionFingerprint({ ...orderRequest, cliente_documento: undefined, whatsapp_status_opt_in: undefined });
    let idempotencyKey: string;
    try {
      idempotencyKey = resolvePersistentIdempotencyKey(fingerprint);
    } catch (error) {
      console.warn("Não foi possível criar uma chave de idempotência segura:", error);
      setErrorMessage("Não foi possível iniciar o pedido com segurança. Atualize o navegador e tente novamente.");
      return;
    }

    const isLocalSimulation =
      isLocalSimulationProp
      ?? isLocalOrderSimulation();

    if (isLocalSimulation) {
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setErrorMessage("");
      setRequiresCartReview(false);
      setCanCorrectSubmission(false);

      const simComandaId = `sim-local-${Date.now()}`;
      const simOrderNumber = "SIM-101";
      const simOrderObj = {
        id: simComandaId,
        numero_pedido: simOrderNumber,
        timestamp: Date.now(),
        restaurante_id: targetRestauranteId,
        cliente_nome: normalizedName,
        cliente_telefone: normalizedPhone,
        tipo: storedFulfillmentLabel(deliveryMethod),
        total: estimatedTotal,
        idempotency_key: idempotencyKey,
        status: "recebido",
        itens: cart.map((item) => ({
          id: item.product.id,
          nome: item.product.name,
          quantidade: item.quantity,
          observacao: item.notes,
        })),
      };
      try {
        saveStoredOrder(simOrderObj);
      } catch (error) {
        console.warn("Não foi possível salvar pedido simulado localmente:", error);
      }
      clearPendingSubmission(idempotencyKey);

      const simulatedPayload: CreatedOrder = {
        comanda_id: simComandaId,
        numero_pedido: simOrderNumber,
        total: estimatedTotal,
        fulfillment: deliveryMethod,
        delivery_address: deliveryMethod === "delivery" ? normalizedAddress : "",
        scheduled_for: scheduledForIso || null,
      };
      setCreatedOrder(simulatedPayload);
      onOrderCreated?.(simulatedPayload);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");
    setRequiresCartReview(false);
    setCanCorrectSubmission(false);

    const diagnostic = beginCheckoutDiagnostic(targetRestauranteId);
    let diagnosticOutcome: CheckoutOutcome | undefined;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ORDER_REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
        ...diagnostic.headers,
      };
      if (customerToken) headers["X-Koma-Customer-Token"] = customerToken;

      // Validate against a fresh public snapshot before attempting to create an order.
      // The cart is a draft; a daily-menu change must not be silently discarded.
      const catalogResponse = await fetchWithInlineSupport(
        `${API_BASE_URL}/api/cardapio-digital/public?restaurante_id=${targetRestauranteId}`,
        { cache: "no-store", signal: controller.signal },
      );
      diagnostic.response(catalogResponse);
      if (!catalogResponse.ok) {
        throw new Error("Não foi possível atualizar o cardápio para confirmar a sacola. Tente novamente.");
      }
      const latestCatalog = await catalogResponse.json();
      const outdatedProducts = findOutdatedCartProducts(cart, latestCatalog);
      if (outdatedProducts.length) {
        diagnosticOutcome = 'catalog_changed';
        setCanCorrectSubmission(true);
        setRequiresCartReview(true);
        throw new Error(
          "O cardápio mudou desde a montagem. Revise os itens " +
          outdatedProducts.join(", ") +
          " na sacola antes de enviar. Nenhum pedido foi criado.",
        );
      }

      diagnostic.setStage('submission');
      const response = await fetchWithInlineSupport(`${API_BASE_URL}/cardapio/pedidos`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          ...orderRequest,
          idempotency_key: idempotencyKey,
        }),
      });

      diagnostic.response(response);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setCanCorrectSubmission([400, 404, 422].includes(response.status));
      }
      if (response.status === 401 && customerToken) {
        diagnosticOutcome = 'session_expired';
        onSessionExpired?.();
        throw new Error("Sua identificação expirou. Você pode tentar novamente sem perder a sacola.");
      }
      if (isOrderingBlockConflict(response.status, data?.detail)) {
        clearPendingSubmission(idempotencyKey);
        idempotencyKeyRef.current = "";
        idempotencyFingerprintRef.current = null;
        diagnostic.finish('ordering_blocked');
        setOrderingBlocked(true);
        return;
      }
      if (!response.ok || !(data?.comanda_id || data?.id) || data?.numero_pedido == null) {
        // A catalogue update can race with the fresh snapshot above.
        // Keep technical request IDs in backend logs; show a useful next action.
        const detail = typeof data?.detail === "string" ? data.detail : "";
        const changedItem = response.status === 404 && (
          detail === "Modificador não encontrado ou inativo."
          || detail.startsWith("Um complemento escolhido não está mais disponível")
          || detail.startsWith("Produto '")
        );
        if (changedItem) setRequiresCartReview(true);
        throw new Error(
          changedItem
            ? "O restaurante acabou de alterar a disponibilidade de um item ou complemento da sua sacola. Revise as opções atualizadas antes de confirmar o pedido."
            : formatCardapioApiError(data),
        );
      }

      const comandaId = String(data.comanda_id || data.id);
      const numeroPedido = Number(data.numero_pedido);
      if (!comandaId || !Number.isFinite(numeroPedido)) {
        throw new Error("O restaurante confirmou o pedido com uma resposta inválida. Tente consultar novamente.");
      }

      diagnostic.finish('accepted');
      const authoritativeTotal = Number(data.total);
      const orderTotal = Number.isFinite(authoritativeTotal) ? authoritativeTotal : estimatedTotal;
      const confirmedSchedule = String(data.scheduled_for || scheduledForIso || "") || undefined;
      const orderObj = {
        id: comandaId,
        numero_pedido: String(numeroPedido),
        timestamp: Date.now(),
        restaurante_id: targetRestauranteId,
        cliente_nome: normalizedName,
        cliente_telefone: normalizedPhone,
        tipo: storedFulfillmentLabel(deliveryMethod),
        total: orderTotal,
        idempotency_key: idempotencyKey,
        status: confirmedSchedule
          ? "agendado"
          : data.pagamento?.cobranca_online && data.pagamento?.status !== "approved"
            ? "aguardando_pagamento"
            : "pendente",
        itens: cart.map((item) => ({
          id: item.product.id,
          nome: item.product.name,
          quantidade: item.quantity,
          observacao: item.notes,
        })),
        tracking_token: data.tracking_token,
        tracking_url: data.tracking_url,
        pagamento: data.pagamento,
      };
      try {
        saveStoredOrder(orderObj);
      } catch (error) {
        console.warn("Não foi possível salvar pedido ativo no navegador:", error);
      }

      clearPendingSubmission(idempotencyKey);
      trackAnalyticsEvent('public_order_submitted', {
        restaurant_id: targetRestauranteId,
        comanda_id: comandaId,
        numero_pedido: numeroPedido,
        total: orderTotal,
        fulfillment: deliveryMethod,
        payment_method: orderRequest.forma_pagamento,
        payment_method_detail: paymentMethodDetail || 'nao_definido',
        items_count: cart.reduce((tot, item) => tot + item.quantity, 0),
        is_scheduled: Boolean(confirmedSchedule),
        has_coupon: Boolean(cupomCodigo),
        has_cashback: Boolean(usarCashback),
      });
      const createdPayload: CreatedOrder = {
        comanda_id: comandaId,
        numero_pedido: numeroPedido,
        total: orderTotal,
        fulfillment: deliveryMethod,
        delivery_address: deliveryMethod === "delivery" ? normalizedAddress : "",
        pagamento: data.pagamento,
        scheduled_for: confirmedSchedule,
        tracking_token: data.tracking_token,
        tracking_url: data.tracking_url,
      };
      setCreatedOrder(createdPayload);
      onOrderCreated?.(createdPayload);
    } catch (error) {
      setSupportCode(diagnostic.finish(diagnosticOutcome || diagnostic.failure(error)));
      setErrorMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "A confirmação demorou mais que o esperado. Tente novamente: o Kôma reutiliza a mesma tentativa sem duplicar o pedido."
          : authRequestErrorMessage(
              error,
              "Não foi possível enviar o pedido. Verifique sua conexão e tente novamente.",
            ),
      );
    } finally {
      window.clearTimeout(timeoutId);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      !createdOrder?.pagamento?.cobranca_online
      || !["created", "pending", "in_process"].includes(createdOrder.pagamento.status)
    ) return;
    let cancelled = false;
    const stopPolling = startPaymentStatusPolling(async (signal) => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/cardapio/pedidos/${encodeURIComponent(createdOrder.comanda_id)}/status?key=${encodeURIComponent(idempotencyKeyRef.current)}`,
          { cache: "no-store", signal },
        );
        if (!response.ok || cancelled || signal.aborted) return;
        const payload = await response.json();
        if (cancelled || signal.aborted) return;
        const nextStatus = String(payload?.pagamento?.status || "pending");
        setCreatedOrder((current) => current ? {
          ...current,
          pagamento: current.pagamento
            ? { ...current.pagamento, ...(payload?.pagamento || {}), status: nextStatus }
            : current.pagamento,
        } : current);
      } catch {
        // O webhook é a autoridade; uma falha pontual de rede ou DNS só adia a checagem sem travar a UI.
      }
    });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [createdOrder?.comanda_id, createdOrder?.pagamento?.cobranca_online, createdOrder?.pagamento?.status]);

  const handleFinish = (openOrdersDrawer = false) => {
    if (!createdOrder) return;
    const finishedOrder = createdOrder;
    onOrderSuccess(finishedOrder);
    if (openOrdersDrawer && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("koma:open-orders-drawer", {
          detail: { orderId: finishedOrder.comanda_id },
        }),
      );
    }
  };

  const isCreatedOrderScheduled = Boolean(createdOrder?.scheduled_for);
  const createdScheduleLabel = formatScheduledDate(createdOrder?.scheduled_for);
  const FulfillmentIcon = deliveryMethod === "delivery" ? Bike : deliveryMethod === "dine_in" ? Store : ShoppingBag;
  const PaymentIcon = paymentMethodDetail === "pix" ? QrCode : paymentMethodDetail === "dinheiro" ? Banknote : CreditCard;
  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4 animate-fade-in"
      style={{ backgroundColor: "var(--km-overlay)" }}
      id="cardapio-checkout-overlay"
    >
      <div
        className={`relative flex ${createdOrder ? "h-auto max-h-[94dvh]" : "h-[calc(100dvh-16px)] max-h-[calc(100dvh-16px)]"} sm:h-auto sm:max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-[var(--km-line)] bg-[var(--km-dialog)] text-[var(--km-ink)] shadow-2xl sm:rounded-[28px] animate-scale-up`}
        id="checkout-card"
      >
        {!createdOrder && (
          <header className="shrink-0 border-b border-[var(--km-line-subtle)] px-5 pt-4 pb-3.5 sm:px-6 sm:pt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {orderingBlocked ? (
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border"
                    style={{
                      borderColor: "var(--km-alert-border)",
                      backgroundColor: "var(--km-alert-soft)",
                      color: "var(--km-alert-text)",
                    }}
                  >
                    <AlertCircle className="h-5 w-5" />
                  </div>
                ) : (
                  <KomaBagAsset className="h-10 w-10 shrink-0" />
                )}
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-black tracking-tight text-[var(--km-ink)] truncate">
                    {orderingBlocked ? "Novos pedidos bloqueados" : "Confira seu pedido"}
                  </h2>
                  <p className="text-[11px] text-[var(--km-muted)] truncate">
                    {orderingBlocked
                      ? "O restaurante não está aceitando pedidos para este contato agora."
                      : "Tudo certo? É só tocar em enviar."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!orderingBlocked && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onEditCart || onClose}
                    className="inline-flex h-10 items-center gap-1 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-3 text-xs font-bold text-[var(--km-ink-2)] transition hover:border-[var(--km-accent-border)] hover:text-[var(--km-ink)] disabled:opacity-40 cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Editar</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => !isSubmitting && onClose()}
                  className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] transition hover:text-[var(--km-ink)] disabled:cursor-wait disabled:opacity-35 cursor-pointer"
                  id="btn-close-checkout"
                  aria-label="Fechar revisão do pedido"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </header>
        )}

        <div className="flex-1 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:p-6 overscroll-contain no-scrollbar">
          {createdOrder ? (
            <div className="flex flex-col items-center justify-center py-2 text-center sm:py-5 animate-scale-up">
              <KomaOrderStatusAsset className="h-12 w-12" />
              <span className="mt-2.5 rounded-full border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]">
                {createdOrder.pagamento?.cobranca_online && createdOrder.pagamento.status !== "approved"
                  ? "Aguardando pagamento"
                  : isCreatedOrderScheduled
                    ? "Pedido agendado"
                    : "Pedido confirmado"}
              </span>
              <h3 className="mt-1.5 font-display text-2xl font-black tracking-tight text-[var(--km-ink)]">
                Pedido #{createdOrder.numero_pedido}
              </h3>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--km-muted)]">
                {createdOrder.pagamento?.cobranca_online && createdOrder.pagamento.status !== "approved"
                  ? (createdOrder.pagamento.confirmacao_manual
                    ? "Pague o Pix abaixo. O restaurante conferirá o recebimento antes de liberar seu pedido."
                    : "Pague o Pix abaixo. O pedido entra no preparo assim que o pagamento confirmar.")
                  : isCreatedOrderScheduled
                    ? `Reservado para ${createdScheduleLabel}. Ele entra na operação no horário escolhido.`
                    : "Já enviamos para o restaurante. Acompanhe cada etapa ao vivo em Pedidos."}
              </p>

              {createdOrder.pagamento?.cobranca_online && createdOrder.pagamento.status !== "approved" && (
                <div className="mt-5 w-full max-w-md rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-card)] p-4">
                  {!createdOrder.pagamento.qr_code_base64 && createdOrder.pagamento.qr_code && <QRCodeSVG value={createdOrder.pagamento.qr_code} size={208} level="M" marginSize={4} className="mx-auto rounded-xl bg-white p-2" />}
                  {createdOrder.pagamento.qr_code_base64 && <img className="mx-auto h-52 w-52 rounded-xl bg-white p-2" src={`data:image/png;base64,${createdOrder.pagamento.qr_code_base64}`} alt="QR Code Pix do pedido" />}
                  {createdOrder.pagamento.qr_code && <PixCopyCode code={createdOrder.pagamento.qr_code} />}
                  <DirectPixCustomerConfirm
                    order={{
                      id: createdOrder.comanda_id,
                      idempotency_key: idempotencyKeyRef.current,
                      tracking_token: createdOrder.tracking_token,
                      tracking_url: createdOrder.tracking_url,
                      pagamento: createdOrder.pagamento,
                    }}
                    apiBaseUrl={API_BASE_URL}
                    onReported={(nextPayment) => {
                      setCreatedOrder((current) => current ? {
                        ...current,
                        pagamento: current.pagamento ? { ...current.pagamento, ...nextPayment } : { ...nextPayment, status: nextPayment.status || "pending", cobranca_online: true },
                      } : current);
                    }}
                  />
                  {createdOrder.pagamento.ticket_url && <a href={createdOrder.pagamento.ticket_url} target="_blank" rel="noreferrer" className="mt-2 flex h-11 w-full items-center justify-center rounded-xl border border-[var(--km-line)] bg-[var(--km-raised)] text-xs font-bold text-[var(--km-ink)]">Abrir pagamento</a>}
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--km-muted)]">{createdOrder.pagamento.confirmacao_manual ? "O restaurante confirmará o recebimento. Você pode acompanhar o pedido neste cardápio." : "A confirmação é automática. Você pode acompanhar o pedido neste cardápio."}</p>
                </div>
              )}

              <div className="mt-3.5 grid w-full max-w-md grid-cols-2 gap-2.5 text-left">
                <div className="min-w-0 rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--km-muted)]">
                    <FulfillmentIcon className="h-3.5 w-3.5 shrink-0 text-[var(--km-accent-text)]" aria-hidden="true" />
                    <span className="truncate">{checkoutFulfillmentLabel(createdOrder.fulfillment || deliveryMethod)}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-snug text-[var(--km-ink)] break-words">
                    {createdOrder.fulfillment === "delivery" ? (createdOrder.delivery_address || "Entrega no endereço informado") : createdOrder.fulfillment === "dine_in" ? "Consumo no local" : "Retirada no balcão"}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[var(--km-muted)]">Total</span>
                  <p className="mt-1 font-display text-lg font-black text-[var(--km-accent-text)] tabular-nums sm:text-xl">
                    {formatPrice(createdOrder.total ?? estimatedTotal)}
                  </p>
                </div>
                {isCreatedOrderScheduled && (
                  <div className="col-span-2 min-w-0 rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--km-accent-text)]">Agendado para</span>
                    <p className="mt-1 text-xs font-bold text-[var(--km-ink)]">{createdScheduleLabel}</p>
                  </div>
                )}
              </div>

              <div className="mt-3.5 w-full max-w-md space-y-2.5">
                <button
                  type="button"
                  id="btn-track-created-order"
                  onClick={() => handleFinish(true)}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--km-accent)] px-5 text-xs font-black uppercase tracking-wider text-[var(--km-on-accent)] shadow-md transition hover:bg-[var(--km-accent-hover)] active:scale-[0.99] cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Acompanhar pedido ao vivo</span>
                </button>
              </div>

              {!customerToken && onCreateAccount && (
                <section
                  className="mt-3 w-full max-w-md rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3 text-left shadow-sm"
                  aria-labelledby="post-purchase-account-title"
                >
                  <div className="flex items-center gap-3">
                    <KomaAccountInviteAsset className="h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h4 id="post-purchase-account-title" className="font-display text-sm font-black leading-tight text-[var(--km-ink)] sm:text-base">
                        Peça em 1 toque da próxima vez
                      </h4>
                      <p className="mt-0.5 text-xs leading-snug text-[var(--km-muted)]">
                        Salve seu endereço e repita pedidos sem digitar tudo de novo.
                      </p>
                      <button
                        type="button"
                        aria-label="Criar conta com meus dados"
                        onClick={() => {
                          handleFinish(false);
                          onCreateAccount();
                        }}
                        className="mt-2 flex h-10 w-full items-center justify-between rounded-full bg-[var(--km-accent)] px-4 text-xs font-black text-[var(--km-on-accent)] transition hover:bg-[var(--km-accent-hover)] cursor-pointer"
                      >
                        <span>Criar conta grátis</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <p className="mt-1 text-center text-[10px] text-[var(--km-muted)]">Opcional · leva menos de 1 minuto</p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          ) : orderingBlocked ? (
            <div className="mx-auto flex min-h-[360px] w-full max-w-md flex-col items-center justify-center py-8 text-center animate-scale-up">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-rose-500/25 bg-rose-500/10 text-rose-500 dark:text-rose-400">
                <AlertCircle className="h-9 w-9" />
              </div>
              <h3 className="mt-5 font-display text-xl font-black tracking-tight text-[var(--km-ink)]">Não é possível enviar um novo pedido agora</h3>
              <p className="mt-2 text-xs leading-relaxed text-[var(--km-muted)]">O restaurante bloqueou temporariamente novos pedidos associados a este contato.</p>
              <div className="mt-5 w-full rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-4 text-left">
                <div className="flex items-start gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--km-accent-text)]" />
                  <p className="text-[11px] leading-relaxed text-[var(--km-muted)]">Se um pedido anterior foi recusado, abra <strong className="text-[var(--km-ink)]">Meus Pedidos</strong> e consulte o acompanhamento daquele pedido.</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-4 text-xs font-black uppercase tracking-wider text-[var(--km-ink)] transition hover:border-[var(--km-accent-border)] cursor-pointer">
                <ArrowLeft className="h-4 w-4" /> Voltar ao cardápio
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Bloco 1: Seu pedido */}
              <section className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-4">
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--km-line-subtle)]">
                  <div className="flex items-center gap-2.5">
                    <KomaBagAsset className="h-7 w-7 shrink-0" />
                    <h3 className="text-xs font-black text-[var(--km-ink)]">Seu pedido</h3>
                  </div>
                  <span className="rounded-full bg-[var(--km-raised)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--km-muted)] tabular-nums">
                    {totalItemsCount} {totalItemsCount === 1 ? "item" : "itens"}
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {cart.map((item) => {
                    let unitPrice = item.product.price;
                    Object.values(item.selectedOptions).forEach((options) => options.forEach((option) => { unitPrice += option.extraPrice; }));
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <span className="block font-bold text-[var(--km-ink)] leading-snug">
                            <span className="text-[var(--km-accent-text)] font-black tabular-nums">{item.quantity}×</span> {item.product.name}
                          </span>
                          {item.promotionParts
                            ? <div className="mt-1 space-y-1 text-[11px] text-[var(--km-muted)]">{item.promotionParts.map((part, index) => (
                                <p key={index}><strong className="text-[var(--km-ink-2)]">{part.product.name}:</strong> {Object.values(part.selectedOptions).flat().map(opt => opt.name).join(', ') || 'Sem adicionais'}{part.notes ? ` · ${part.notes}` : ''}</p>
                              ))}</div>
                            : <OrderItemComposition item={cardapioCompositionSource(item)} className="mt-0.5 text-[11px] text-[var(--km-muted)]" />}
                          {item.notes && <span className="mt-1 inline-block rounded-lg bg-[var(--km-raised)] px-2 py-0.5 text-[11px] leading-relaxed text-[var(--km-ink-2)]">Obs.: {item.notes}</span>}
                        </div>
                        <span className="shrink-0 font-bold text-[var(--km-ink)] tabular-nums">{formatPrice(unitPrice * item.quantity)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Bloco 2: Entrega / Retirada */}
              <section className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-4">
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--km-line-subtle)]">
                  {deliveryMethod === "delivery" ? (
                    <KomaDeliveryAsset className="h-7 w-7 shrink-0" />
                  ) : deliveryMethod === "dine_in" ? (
                    <KomaDineInAsset className="h-7 w-7 shrink-0" />
                  ) : (
                    <KomaPickupAsset className="h-7 w-7 shrink-0" />
                  )}
                  <h3 className="text-xs font-black text-[var(--km-ink)]">{checkoutFulfillmentLabel(deliveryMethod)}</h3>
                </div>
                <div className="mt-2.5 space-y-1.5 text-xs">
                  <div className="flex items-start gap-2 text-[var(--km-ink)]">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--km-muted)]" aria-hidden="true" />
                    <p className="font-semibold leading-snug">
                      {deliveryMethod === "delivery" ? address : deliveryMethod === "dine_in" ? activeBrand.address || "Consumo no estabelecimento" : activeBrand.address || "Retirada no balcão do restaurante"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--km-muted)]">
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-[var(--km-muted)]" aria-hidden="true" />
                    <span className="truncate font-semibold text-[var(--km-ink-2)]">{customerName}</span>
                    <span>·</span>
                    <span className="tabular-nums">{customerPhone}</span>
                  </div>
                </div>
              </section>

              {/* Bloco 3: Pagamento */}
              <section className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-4">
                <div>
                  {!paymentError && paymentMethodDetail ? (
                    <CardapioPaymentSummary method={paymentMethodDetail} fulfillment={deliveryMethod} changeFor={trocoPara} isDirectPix={activeBrand.pixDirect === true} />
                  ) : (
                    <p role="alert" className="text-sm font-semibold leading-relaxed" style={{ color: "var(--km-alert-text)" }}>{paymentError} Volte à sacola para conferir.</p>
                  )}
                </div>
                {availablePayments.length > 0 ? (
                  <p className="mt-2.5 border-t border-[var(--km-line-subtle)] pt-2 text-[11px] text-[var(--km-muted)]">
                    Formas disponíveis neste pedido: {availablePayments.map((method) => PAYMENT_LABELS[method]).join(" · ")}
                  </p>
                ) : (
                  <p className="mt-2.5 text-xs font-semibold leading-relaxed" style={{ color: "var(--km-alert-text)" }}>O restaurante ainda não informou as formas aceitas no cardápio.</p>
                )}
              </section>

              {customerWhatsAppStatusEnabled && deliveryMethod !== "dine_in" && (
                <label htmlFor="checkout-whatsapp-status-opt-in"
                  className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors focus-within:ring-2 focus-within:ring-[var(--km-focus)] ${whatsappStatusOptIn
                    ? 'border-[var(--km-accent)] bg-[var(--km-accent-soft)]'
                    : 'border-[var(--km-line)] bg-[var(--km-card)] hover:border-[var(--km-accent-border)]'}`}>
                  <input
                    id="checkout-whatsapp-status-opt-in"
                    type="checkbox"
                    checked={whatsappStatusOptIn}
                    onChange={(event) => setWhatsappStatusOptIn(event.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--km-accent)]"
                  />
                  <span className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--km-ink)]">
                    <span className="flex items-center gap-1.5">
                      <MessageCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--km-accent-text)]" />
                      <strong className="text-xs font-bold">Receba atualizações deste pedido pelo WhatsApp</strong>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--km-muted)]">
                      É grátis e opcional, sem promoções.
                    </span>
                  </span>
                </label>
              )}

              {scheduledOrdersEnabled && (
                <section className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-4">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-[var(--km-accent-text)]" />
                    <h3 className="text-xs font-black text-[var(--km-ink)]">Quando preparar?</h3>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => { setScheduleMode("now"); setScheduledFor(""); setErrorMessage(""); }} className={`h-11 rounded-full border px-3 text-xs font-black transition cursor-pointer ${scheduleMode === "now" ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]" : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)]"}`}>Agora</button>
                    <button type="button" onClick={() => { setScheduleMode("scheduled"); setErrorMessage(""); }} className={`h-11 rounded-full border px-3 text-xs font-black transition cursor-pointer ${scheduleMode === "scheduled" ? "border-[var(--km-accent)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]" : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)]"}`}>Agendar</button>
                  </div>
                  {scheduleMode === "scheduled" && (
                    <div className="mt-3">
                      <label htmlFor="scheduled-order-time" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--km-muted)]">Data e horário</label>
                      <input id="scheduled-order-time" type="datetime-local" min={scheduleMin} max={scheduleMax} value={scheduledFor} onChange={(event) => { setScheduledFor(event.target.value); setErrorMessage(""); }} className="h-11 w-full rounded-xl border border-[var(--km-line)] bg-[var(--km-input)] px-3 text-xs font-semibold text-[var(--km-ink)] outline-none focus:border-[var(--km-focus)]" />
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--km-subtle)]">Entre 30 minutos e 7 dias.</p>
                      {schedulePaymentError && <p className="mt-2 text-xs font-bold text-rose-500 dark:text-rose-300">{schedulePaymentError}</p>}
                    </div>
                  )}
                </section>
              )}

              {/* Total em destaque */}
              <section className="rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-4 space-y-1.5 text-xs">
                <div className="flex justify-between text-[var(--km-muted)]">
                  <span>Subtotal</span>
                  <span className="tabular-nums font-semibold text-[var(--km-ink-2)]">{formatPrice(subtotal)}</span>
                </div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-[var(--km-muted)]">
                    <span>Entrega</span>
                    <span className={`tabular-nums font-semibold ${deliveryFee === 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-[var(--km-ink-2)]"}`}>
                      {deliveryFee === 0 ? "Grátis" : formatPrice(deliveryFee)}
                    </span>
                  </div>
                )}
                {descontoCupom > 0 && (
                  <div className="flex justify-between font-bold text-[var(--km-accent-text)]">
                    <span>Cupom{cupomCodigo ? ` (${cupomCodigo.trim().toUpperCase()})` : ""}</span>
                    <span className="tabular-nums">- {formatPrice(descontoCupom)}</span>
                  </div>
                )}
                {descontoCashback > 0 && (
                  <div className="flex justify-between font-bold text-[var(--km-accent-text)]">
                    <span>Cashback</span>
                    <span className="tabular-nums">- {formatPrice(descontoCashback)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-[var(--km-accent-border)] pt-2.5">
                  <span className="text-sm font-black text-[var(--km-ink)]">Total</span>
                  <span className="font-display text-2xl font-black text-[var(--km-accent-text)] tabular-nums">
                    {formatPrice(estimatedTotal)}
                  </span>
                </div>
              </section>
            </div>
          )}
        </div>

        {!createdOrder && !orderingBlocked && (
          <footer className="shrink-0 border-t border-[var(--km-line-subtle)] bg-[var(--km-panel)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-4">
            {errorMessage && <div className="mb-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-500 dark:text-rose-300" role="alert" id="checkout-submit-error">
              <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div>
                <p className="font-black">Não foi possível enviar o pedido</p>
                <p className="mt-1 max-h-[15dvh] overflow-y-auto font-semibold">{errorMessage}</p>
                {supportCode && <button type="button" className="mt-1 min-h-11 text-left text-[var(--km-ink)] underline underline-offset-4 cursor-pointer" onClick={async () => {
                  try { await navigator.clipboard.writeText(supportCode); setSupportCopied(true); } catch { setSupportCopied(false); }
                }} aria-label={`Copiar código de suporte ${supportCode}`}>{supportCopied ? `Copiado: ${supportCode}` : `Suporte: ${supportCode}`}</button>}
              </div></div>
              {canCorrectSubmission && !requiresCartReview && <button type="button" onClick={onEditCart || onClose} className="mt-2 min-h-11 w-full rounded-full border border-rose-500/30 px-3 font-bold cursor-pointer">Voltar à sacola e corrigir</button>}
            </div>}
            <button
              type="button"
              onClick={requiresCartReview ? (onEditCart || onClose) : handlePlaceOrder}
              disabled={isSubmitting || cart.length === 0 || (!requiresCartReview && Boolean(paymentError || schedulePaymentError))}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[var(--km-accent)] px-5 text-xs font-black uppercase tracking-wider text-[var(--km-on-accent)] shadow-md transition hover:bg-[var(--km-accent-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[var(--km-raised)] disabled:text-[var(--km-muted)] cursor-pointer"
              id="btn-place-order-final"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>{isSubmitting ? "Enviando pedido…" : requiresCartReview ? "Revisar sacola" : paymentError || schedulePaymentError ? "Confira o pagamento" : errorMessage ? "Tentar novamente" : scheduleMode === "scheduled" ? "Agendar pedido" : "Enviar pedido"}</span>
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
