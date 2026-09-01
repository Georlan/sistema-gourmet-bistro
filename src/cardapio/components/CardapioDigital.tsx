/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  MapPin,
  MessageCircle,
  Send,
  ShoppingBag,
  UserRound,
  X,
} from "lucide-react";
import { BrandConfig } from "../CardapioTypes";
import { CartItem } from "./CardapioCartDrawer";
import { API_BASE_URL } from "../../config/api";
import { openWhatsAppMessage, buildPedidoConfirmadoMsg } from "../../config/whatsappUtils";
import { saveStoredOrder } from "../orderTracking";
import { buildCardapioOrderItems } from "../orderItems";
import CardapioPaymentSummary from "./CardapioPaymentSummary";
import { getAvailablePaymentMethods, getPaymentSelectionError } from "../paymentMethods";

interface CreatedOrder {
  comanda_id: string;
  numero_pedido: string | number;
  total?: number;
  pagamento?: OnlinePaymentResponse;
}

interface OnlinePaymentResponse {
  status: string;
  cobranca_online: boolean;
  metodo?: string;
  qr_code?: string | null;
  qr_code_base64?: string | null;
  ticket_url?: string | null;
  expira_em?: string | null;
}

interface CardapioDigitalProps {
  activeBrand: BrandConfig;
  cart: CartItem[];
  deliveryFee: number;
  deliveryMethod: "delivery" | "pickup";
  address: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerToken?: string | null;
  paymentMethodDetail?: "dinheiro" | "pix" | "cartao_credito" | "cartao_debito";
  trocoPara?: number;
  bairro?: string;
  cupomCodigo?: string;
  descontoCupom?: number;
  usarCashback?: boolean;
  descontoCashback?: number;
  onClose: () => void;
  onOrderSuccess: (order: CreatedOrder) => void;
  onSessionExpired?: () => void;
}

interface PendingOrderSubmission {
  key: string;
  fingerprint: string;
  createdAt: number;
}

const PENDING_ORDER_STORAGE_KEY = "koma_pending_order_submission";
const PENDING_ORDER_TTL_MS = 15 * 60 * 1000;
const ORDER_REQUEST_TIMEOUT_MS = 15_000;

const createIdempotencyKey = () => (
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `ik-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`
);

const formatPrice = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(value);

export default function CardapioDigital({
  activeBrand,
  cart,
  deliveryFee,
  deliveryMethod,
  address,
  customerName,
  customerPhone,
  customerEmail,
  customerToken,
  paymentMethodDetail,
  trocoPara,
  bairro,
  cupomCodigo,
  descontoCupom = 0,
  usarCashback = false,
  descontoCashback = 0,
  onClose,
  onOrderSuccess,
  onSessionExpired,
}: CardapioDigitalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

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
  const paymentMethods = useMemo(
    () => (activeBrand.paymentMethods || []).filter((method) => method?.type),
    [activeBrand.paymentMethods],
  );
  const availablePayments = useMemo(() => getAvailablePaymentMethods(activeBrand.paymentMethods), [activeBrand.paymentMethods]);
  const paymentError = getPaymentSelectionError(paymentMethodDetail, availablePayments);

  const resolvePersistentIdempotencyKey = (fingerprint: string) => {
    let key = idempotencyKeyRef.current;
    try {
      const raw = localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as PendingOrderSubmission;
        const isFresh = Number.isFinite(pending.createdAt)
          && Date.now() - pending.createdAt <= PENDING_ORDER_TTL_MS;
        if (pending.key && pending.fingerprint === fingerprint && isFresh) {
          key = pending.key;
        }
      }

      localStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify({
        key,
        fingerprint,
        createdAt: Date.now(),
      } satisfies PendingOrderSubmission));
    } catch (error) {
      console.warn("Não foi possível persistir a tentativa do pedido:", error);
    }
    idempotencyKeyRef.current = key;
    return key;
  };

  const clearPendingSubmission = (key: string) => {
    try {
      const raw = localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingOrderSubmission;
      if (pending.key === key) localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    } catch (error) {
      console.warn("Não foi possível limpar a tentativa confirmada:", error);
    }
  };

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;
    if (paymentError) {
      setErrorMessage(paymentError);
      return;
    }

    const targetRestauranteId = Number(activeBrand.id);
    const normalizedPhone = customerPhone.replace(/\D/g, "");
    const normalizedName = customerName.trim();
    const normalizedAddress = address.trim();

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

    const savedMesa = localStorage.getItem("koma_mesa_numero");
    const finalClienteNome = (savedMesa && deliveryMethod !== "delivery")
      ? `${normalizedName} (Mesa ${savedMesa})`
      : normalizedName;

    const cleanedItems = buildCardapioOrderItems(cart, finalClienteNome);

    const fingerprint = JSON.stringify({
      restaurante_id: targetRestauranteId,
      cliente_telefone: normalizedPhone,
      tipo_pedido: deliveryMethod,
      endereco: deliveryMethod === "delivery" ? normalizedAddress : "",
      itens: cleanedItems,
    });
    const idempotencyKey = resolvePersistentIdempotencyKey(fingerprint);

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ORDER_REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      };
      if (customerToken) headers["X-Koma-Customer-Token"] = customerToken;

      const response = await fetch(`${API_BASE_URL}/cardapio/pedidos`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          restaurante_id: targetRestauranteId,
          itens: cleanedItems,
          cliente_nome: finalClienteNome,
          cliente_telefone: normalizedPhone,
          endereco_entrega: deliveryMethod === "delivery" ? normalizedAddress : "",
          taxa_entrega: deliveryMethod === "delivery" ? deliveryFee : 0,
          forma_pagamento: paymentMethodDetail === "dinheiro" ? "na_entrega" : "online",
          forma_pagamento_detalhe: paymentMethodDetail,
          cliente_email: paymentMethodDetail === "pix" ? customerEmail : undefined,
          troco_para: paymentMethodDetail === "dinheiro" ? trocoPara : undefined,
          bairro: bairro,
          cupom_codigo: cupomCodigo,
          usar_cashback: usarCashback,
          tipo_pedido: deliveryMethod === "delivery" ? "delivery" : "retirada",
          idempotency_key: idempotencyKey,
        }),
      });

      const data = await response.json().catch(() => null);
      if (response.status === 401 && customerToken) {
        onSessionExpired?.();
        throw new Error("Sua identificação expirou. Você pode tentar novamente sem perder a sacola.");
      }
      if (!response.ok || !(data?.comanda_id || data?.id) || data?.numero_pedido == null) {
        throw new Error(data?.detail || "Não foi possível registrar o pedido. Tente novamente.");
      }

      const comandaId = String(data.comanda_id || data.id);
      const numeroPedido = Number(data.numero_pedido);
      if (!comandaId || !Number.isFinite(numeroPedido)) {
        throw new Error("O restaurante confirmou o pedido com uma resposta inválida. Tente consultar novamente.");
      }

      const authoritativeTotal = Number(data.total);
      const orderTotal = Number.isFinite(authoritativeTotal) ? authoritativeTotal : estimatedTotal;
      const orderObj = {
        id: comandaId,
        numero_pedido: String(numeroPedido),
        timestamp: Date.now(),
        restaurante_id: targetRestauranteId,
        cliente_nome: normalizedName,
        cliente_telefone: normalizedPhone,
        tipo: deliveryMethod === "delivery" ? "Delivery" : "Retirada",
        total: orderTotal,
        idempotency_key: idempotencyKey,
        status: data.pagamento?.cobranca_online && data.pagamento?.status !== "approved"
          ? "aguardando_pagamento"
          : "pendente",
        itens: cart.map((item) => ({
          id: item.product.id,
          nome: item.product.name,
          quantidade: item.quantity,
          observacao: item.notes,
        })),
      };
      try {
        saveStoredOrder(orderObj);
      } catch (error) {
        console.warn("Não foi possível salvar pedido ativo no localStorage:", error);
      }

      clearPendingSubmission(idempotencyKey);
      setCreatedOrder({
        comanda_id: comandaId,
        numero_pedido: numeroPedido,
        total: orderTotal,
        pagamento: data.pagamento,
      });
    } catch (error) {
      console.warn("Falha ao registrar pedido no backend:", error);
      setErrorMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "A confirmação demorou mais que o esperado. Tente novamente: o Kôma reutiliza a mesma tentativa sem duplicar o pedido."
          : error instanceof Error
            ? error.message
            : "Não foi possível enviar o pedido. Verifique sua conexão e tente novamente.",
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
    const checkPayment = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/cardapio/pedidos/${encodeURIComponent(createdOrder.comanda_id)}/status?key=${encodeURIComponent(idempotencyKeyRef.current)}`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const payload = await response.json();
        const nextStatus = String(payload?.pagamento?.status || "pending");
        setCreatedOrder((current) => current ? {
          ...current,
          pagamento: current.pagamento ? { ...current.pagamento, status: nextStatus } : current.pagamento,
        } : current);
      } catch {
        // O webhook é a autoridade; uma falha de consulta só adia a atualização visual.
      }
    };
    void checkPayment();
    const interval = window.setInterval(() => void checkPayment(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [createdOrder?.comanda_id, createdOrder?.pagamento?.cobranca_online, createdOrder?.pagamento?.status]);

  const handleFinish = () => {
    if (createdOrder) onOrderSuccess(createdOrder);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/75 p-0 sm:items-center sm:p-4 animate-fade-in" id="cardapio-checkout-overlay">
      <div className="relative flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[30px] border border-koma-border bg-koma-panel text-koma-foreground shadow-2xl sm:rounded-[30px] animate-scale-up" id="checkout-card">
        {!createdOrder && (
          <header className="shrink-0 border-b border-koma-border px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-500"><ShoppingBag className="h-3.5 w-3.5" /> Etapa final</div>
                <h2 className="mt-1.5 font-display text-lg font-black tracking-tight text-koma-foreground">Revise e confirme</h2>
                <p className="mt-1 text-[10px] text-koma-muted">Confira contato, modalidade, itens e total antes do envio.</p>
              </div>
              <button type="button" disabled={isSubmitting} onClick={() => !isSubmitting && onClose()} className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-koma-muted transition hover:bg-koma-raised hover:text-koma-foreground disabled:cursor-wait disabled:opacity-35" id="btn-close-checkout" aria-label="Fechar revisão do pedido"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-[9px] font-bold">
              {["Sacola", deliveryMethod === "delivery" ? "Entrega" : "Retirada", "Revisão"].map((label, index) => (
                <div key={label} className={index < 2 ? "flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-2 py-2 text-emerald-500" : "flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-2 text-koma-foreground"}>
                  {index < 2 ? <Check className="h-3 w-3" /> : <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[8px] text-white">3</span>}{label}
                </div>
              ))}
            </div>
          </header>
        )}

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 no-scrollbar">
          {createdOrder ? (
            <div className="flex flex-col items-center justify-center py-7 text-center sm:py-10 animate-scale-up">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-500"><CheckCircle2 className="h-9 w-9" /></div>
              <span className="mt-5 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-500">{createdOrder.pagamento?.cobranca_online && createdOrder.pagamento.status !== "approved" ? "Aguardando pagamento" : "Pedido recebido"}</span>
              <h3 className="mt-1.5 font-display text-2xl font-black tracking-tight text-koma-foreground">Pedido #{createdOrder.numero_pedido}</h3>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-koma-muted">{createdOrder.pagamento?.cobranca_online && createdOrder.pagamento.status !== "approved" ? "Pague o Pix abaixo. O pedido só aparecerá para o restaurante depois da confirmação automática." : "Seu pedido entrou no painel do restaurante e está aguardando aceite. Você pode acompanhar o andamento neste mesmo cardápio."}</p>

              {createdOrder.pagamento?.cobranca_online && createdOrder.pagamento.status !== "approved" && (
                <div className="mt-5 w-full max-w-md rounded-2xl border border-emerald-500/25 bg-koma-card p-4">
                  {createdOrder.pagamento.qr_code_base64 && <img className="mx-auto h-52 w-52 rounded-xl bg-white p-2" src={`data:image/png;base64,${createdOrder.pagamento.qr_code_base64}`} alt="QR Code Pix do pedido" />}
                  {createdOrder.pagamento.qr_code && <button type="button" onClick={() => void navigator.clipboard.writeText(createdOrder.pagamento?.qr_code || "")} className="mt-3 h-11 w-full rounded-xl bg-emerald-500 px-4 text-xs font-black text-white">Copiar código Pix</button>}
                  {createdOrder.pagamento.ticket_url && <a href={createdOrder.pagamento.ticket_url} target="_blank" rel="noreferrer" className="mt-2 flex h-11 w-full items-center justify-center rounded-xl border border-koma-border text-xs font-bold text-koma-foreground">Abrir pagamento</a>}
                  <p className="mt-2 text-[10px] leading-relaxed text-koma-muted">A confirmação é automática. Não feche esta tela até concluir o pagamento.</p>
                </div>
              )}

              <div className="mt-5 grid w-full max-w-md gap-2 text-left sm:grid-cols-2">
                <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5"><span className="text-[9px] font-black uppercase tracking-wider text-koma-muted">Modalidade</span><p className="mt-1 text-[11px] font-semibold leading-relaxed text-koma-foreground">{deliveryMethod === "delivery" ? `Entrega · ${address}` : "Retirada no balcão"}</p></div>
                <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5"><span className="text-[9px] font-black uppercase tracking-wider text-koma-muted">Total</span><p className="mt-1 text-base font-black text-emerald-500">{formatPrice(createdOrder.total ?? estimatedTotal)}</p></div>
              </div>

              <div className="mt-6 w-full max-w-sm space-y-2">
                <button type="button" onClick={handleFinish} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-600"><CheckCircle2 className="h-4 w-4" /> Acompanhar pedido</button>
                {activeBrand.phone && (
                  <button type="button" onClick={() => { const itensStr = cart.map((item) => `${item.quantity}x ${item.product.name}`).join(", "); const msg = buildPedidoConfirmadoMsg(customerName, itensStr, createdOrder.total ?? estimatedTotal); openWhatsAppMessage(String(activeBrand.phone), msg); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-4 text-[10px] font-bold text-koma-secondary transition hover:border-emerald-500/30 hover:text-emerald-500"><MessageCircle className="h-4 w-4" /> Falar com o restaurante</button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-koma-muted"><UserRound className="h-3.5 w-3.5 text-emerald-500" /> Contato</div><p className="mt-2 text-xs font-black text-koma-foreground">{customerName}</p><p className="mt-0.5 text-[10px] text-koma-muted">{customerPhone}</p></div>
                <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-koma-muted"><MapPin className="h-3.5 w-3.5 text-emerald-500" /> {deliveryMethod === "delivery" ? "Entrega" : "Retirada"}</div><p className="mt-2 text-[11px] font-semibold leading-relaxed text-koma-foreground">{deliveryMethod === "delivery" ? address : activeBrand.address || "Retirada no balcão do restaurante"}</p></div>
              </div>

              <section>
                <div className="mb-2.5 flex items-center justify-between"><h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Itens do pedido</h3><button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-500 hover:text-emerald-400"><ArrowLeft className="h-3 w-3" /> Editar sacola</button></div>
                <div className="space-y-2">
                  {cart.map((item) => {
                    let unitPrice = item.product.price;
                    const optionNames: string[] = [];
                    Object.values(item.selectedOptions).forEach((options) => options.forEach((option) => { unitPrice += option.extraPrice; optionNames.push(option.name); }));
                    return <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-koma-border bg-koma-card p-3 text-xs"><div className="min-w-0"><span className="block font-black text-koma-foreground">{item.quantity}x {item.product.name}</span>{optionNames.length > 0 && <span className="mt-0.5 block truncate text-[10px] text-koma-muted">{optionNames.join(", ")}</span>}{item.notes && <span className="mt-1 block text-[10px] leading-relaxed text-amber-500">Obs.: {item.notes}</span>}</div><span className="shrink-0 font-black text-koma-foreground">{formatPrice(unitPrice * item.quantity)}</span></div>;
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-koma-border bg-koma-card p-4">
                {!paymentError && paymentMethodDetail ? <CardapioPaymentSummary method={paymentMethodDetail} fulfillment={deliveryMethod} changeFor={trocoPara} /> : <p role="alert" className="text-sm leading-relaxed text-amber-500">{paymentError} Volte à sacola para conferir.</p>}
                {paymentMethods.length > 0 ? <div className="mt-3 border-t border-koma-border pt-3"><p className="text-xs text-koma-muted">Formas informadas pelo restaurante</p><div className="mt-2 flex flex-wrap gap-1.5">{paymentMethods.map((method) => <span key={method.type} className="rounded-lg border border-koma-border px-2.5 py-1.5 text-xs text-koma-secondary">{method.type}</span>)}</div></div> : <p className="mt-3 text-xs leading-relaxed text-amber-500">O restaurante ainda não informou as formas aceitas no cardápio.</p>}
              </section>

              <section className="space-y-1.5 border-t border-koma-border pt-4 text-xs">
                <div className="flex justify-between text-koma-muted"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                {deliveryMethod === "delivery" && <div className="flex justify-between text-koma-muted"><span>Taxa de entrega estimada</span><span>{formatPrice(deliveryFee)}</span></div>}
                <div className="flex justify-between border-t border-koma-border pt-2 text-sm font-black text-koma-foreground"><span>Total estimado</span><span className="text-base text-emerald-500">{formatPrice(estimatedTotal)}</span></div>
                <p className="pt-1 text-[9px] leading-relaxed text-koma-subtle">O valor definitivo é confirmado pelo sistema do restaurante ao registrar o pedido.</p>
              </section>

              {errorMessage && <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-400" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span></div>}
            </div>
          )}
        </div>

        {!createdOrder && (
          <footer className="shrink-0 border-t border-koma-border bg-koma-panel p-4 sm:px-6 sm:py-5">
            <button type="button" onClick={handlePlaceOrder} disabled={isSubmitting || cart.length === 0 || Boolean(paymentError)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-55" id="btn-place-order-final"><Send className="h-4 w-4" /><span>{isSubmitting ? "Enviando pedido…" : paymentError ? "Confira o pagamento" : errorMessage ? "Tentar novamente" : "Fazer pedido"}</span></button>
            <p className="mt-2 text-center text-[9px] leading-relaxed text-koma-subtle">Pix só entra no painel após o pagamento. Dinheiro entra direto e é cobrado pessoalmente.</p>
          </footer>
        )}
      </div>
    </div>
  );
}
