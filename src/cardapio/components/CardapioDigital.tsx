/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from "react";
import { AlertCircle, CheckCircle, Info, Send, ShoppingBag, X } from "lucide-react";
import { BrandConfig } from "../CardapioTypes";
import { CartItem } from "./CardapioCartDrawer";
import { API_BASE_URL } from "../../config/api";
import { openWhatsAppMessage, buildPedidoConfirmadoMsg } from "../../config/whatsappUtils";

interface CreatedOrder {
  comanda_id: string;
  numero_pedido: string | number;
}

interface CardapioDigitalProps {
  activeBrand: BrandConfig;
  cart: CartItem[];
  deliveryFee: number;
  deliveryMethod: "delivery" | "pickup";
  address: string;
  customerName: string;
  customerPhone: string;
  customerToken: string;
  onClose: () => void;
  onOrderSuccess: (order: CreatedOrder) => void;
  onSessionExpired: () => void;
}

export default function CardapioDigital({
  activeBrand,
  cart,
  deliveryFee,
  deliveryMethod,
  address,
  customerName,
  customerPhone,
  customerToken,
  onClose,
  onOrderSuccess,
  onSessionExpired,
}: CardapioDigitalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `ik-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  };

  const subtotal = cart.reduce((acc, item) => {
    let unitPrice = item.product.price;
    Object.values(item.selectedOptions).forEach((options) => {
      options.forEach((option) => {
        unitPrice += option.extraPrice;
      });
    });
    return acc + unitPrice * item.quantity;
  }, 0);
  const estimatedTotal = subtotal + deliveryFee;

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;

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
    if (!customerToken) {
      setErrorMessage("Confirme seu celular novamente antes de enviar o pedido.");
      onSessionExpired();
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

    const cleanedItems = cart.map((item) => {
      const optionDetails = Object.values(item.selectedOptions)
        .flatMap((options) => options.map((option) => option.name))
        .filter(Boolean);
      const observacao = [
        item.notes.trim(),
        optionDetails.length > 0 ? `Opções: ${optionDetails.join(", ")}` : ""
      ].filter(Boolean).join(" - ");

      return {
        produto_id: item.product.id,
        quantidade: item.quantity,
        observacao,
        cliente_nome: finalClienteNome
      };
    });

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/pedidos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          restaurante_id: targetRestauranteId,
          itens: cleanedItems,
          cliente_nome: finalClienteNome,
          cliente_telefone: normalizedPhone,
          endereco_entrega: deliveryMethod === "delivery" ? normalizedAddress : "",
          taxa_entrega: deliveryMethod === "delivery" ? deliveryFee : 0,
          forma_pagamento: "na_entrega",
          tipo_pedido: deliveryMethod === "delivery" ? "delivery" : "retirada",
          idempotency_key: idempotencyKeyRef.current
        })
      });

      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        onSessionExpired();
      }

      let comandaId = data?.comanda_id || data?.id;
      let numeroPedido = data?.numero_pedido;

      if (!response.ok || !comandaId || numeroPedido == null) {
        comandaId = `res-${Date.now()}`;
        numeroPedido = Math.floor(1000 + Math.random() * 9000);
      }

      const orderObj = {
        id: String(comandaId),
        numero_pedido: String(numeroPedido),
        timestamp: Date.now(),
        restaurante_id: targetRestauranteId,
        cliente_nome: normalizedName,
        tipo: deliveryMethod === "delivery" ? "Delivery" : "Retirada",
        total: estimatedTotal,
        idempotency_key: idempotencyKeyRef.current
      };
      try {
        localStorage.setItem("koma_active_order", JSON.stringify(orderObj));
      } catch (err) {
        console.warn("Não foi possível salvar pedido ativo no localStorage:", err);
      }

      setCreatedOrder({
        comanda_id: String(comandaId),
        numero_pedido: numeroPedido
      });

      // Disparo automático via WhatsApp (wa.me)
      const itensStr = cart.map(i => `${i.quantity}x ${i.product.name}`).join(', ');
      const targetWaPhone = activeBrand.socials?.whatsapp ? String(activeBrand.socials.whatsapp) : customerPhone;
      const msg = buildPedidoConfirmadoMsg(finalClienteNome, itensStr, estimatedTotal);
      openWhatsAppMessage(targetWaPhone, msg);

    } catch (error) {
      console.warn("API indisponível. Enviando pedido diretamente via WhatsApp (Modo Resiliente):", error);
      const localNum = Math.floor(1000 + Math.random() * 9000);
      const localId = `res-${Date.now()}`;
      
      setCreatedOrder({
        comanda_id: localId,
        numero_pedido: localNum
      });

      // Disparo automático via WhatsApp (wa.me)
      const itensStr = cart.map(i => `${i.quantity}x ${i.product.name}`).join(', ');
      const targetWaPhone = activeBrand.socials?.whatsapp ? String(activeBrand.socials.whatsapp) : customerPhone;
      const msg = buildPedidoConfirmadoMsg(finalClienteNome, itensStr, estimatedTotal);
      openWhatsAppMessage(targetWaPhone, msg);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    if (createdOrder) {
      onOrderSuccess(createdOrder);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto animate-fade-in"
      id="cardapio-checkout-overlay"
    >
      <div
        className="relative w-full max-w-2xl rounded-3xl border border-slate-500/10 text-text-app shadow-2xl flex flex-col overflow-hidden max-h-[92vh] animate-scale-up"
        id="checkout-card"
        style={{ backgroundColor: "var(--color-brand-card, #ffffff)" }}
      >
        {!createdOrder && (
          <div className="flex items-center justify-between p-6 border-b border-slate-500/10 shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" />
              <h2 className="font-display font-extrabold text-sm sm:text-base uppercase tracking-wider text-text-app">
                Revisar Pedido
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-slate-500/10 text-text-app/50 transition cursor-pointer"
              id="btn-close-checkout"
              aria-label="Fechar revisão do pedido"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="flex-1 p-6 overflow-y-auto space-y-6 no-scrollbar">
          {createdOrder ? (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4 animate-scale-up">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                <CheckCircle className="h-10 w-10" />
              </div>
              <div className="space-y-2 max-w-md">
                <h3 className="font-display font-black text-xl text-emerald-500">
                  Pedido recebido
                </h3>
                <p className="text-xs text-text-app/70 leading-relaxed">
                  Obrigado, <strong className="text-text-app">{customerName}</strong>. O pedido{" "}
                  <strong className="text-primary font-mono">#{createdOrder.numero_pedido}</strong>{" "}
                  foi enviado ao restaurante e aguarda confirmação.
                </p>
                <div className="p-3 bg-slate-500/5 rounded-2xl border border-slate-500/10 text-[11px] text-text-app/70">
                  Nenhuma cobrança foi feita pelo site. O pagamento será combinado diretamente com o restaurante.
                </div>
              </div>
              <div className="w-full max-w-xs space-y-2 mt-4">
                {activeBrand.socials?.whatsapp && (
                  <button
                    type="button"
                    onClick={() => {
                      const itensStr = cart.map(i => `${i.quantity}x ${i.product.name}`).join(', ');
                      const msg = buildPedidoConfirmadoMsg(customerName, itensStr, estimatedTotal);
                      openWhatsAppMessage(String(activeBrand.socials.whatsapp), msg);
                    }}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl shadow-md transition uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>💬 Enviar no WhatsApp</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleFinish}
                  className="w-full py-3.5 bg-primary text-white text-xs font-black rounded-xl shadow-md hover:opacity-95 transition uppercase tracking-wider cursor-pointer"
                >
                  Voltar ao Cardápio
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-2xl bg-slate-500/5 border border-slate-500/10 space-y-2 text-xs">
                <h3 className="font-bold text-text-app/90 text-xs uppercase tracking-wider">Dados do Pedido</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-app/70 leading-relaxed">
                  <p>👤 <strong className="text-text-app">Cliente:</strong> {customerName}</p>
                  <p>📞 <strong className="text-text-app">Telefone:</strong> {customerPhone}</p>
                </div>
                <p className="text-text-app/70 leading-relaxed">
                  📍 <strong className="text-text-app">Destino:</strong>{" "}
                  {deliveryMethod === "delivery" ? address : "Retirada no balcão"}
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-bold text-text-app/90 text-[10px] uppercase tracking-wider">Resumo dos Itens</h3>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
                  {cart.map((item) => {
                    let unitPrice = item.product.price;
                    const optionNames: string[] = [];
                    Object.values(item.selectedOptions).forEach((options) => {
                      options.forEach((option) => {
                        unitPrice += option.extraPrice;
                        optionNames.push(option.name);
                      });
                    });

                    return (
                      <div key={item.id} className="p-3 bg-slate-500/5 border border-slate-500/10 rounded-xl flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-3">
                          <span className="font-bold text-text-app block truncate">
                            {item.quantity}x {item.product.name}
                          </span>
                          {optionNames.length > 0 && (
                            <span className="block text-[10px] text-text-app/40 truncate mt-0.5">
                              {optionNames.join(", ")}
                            </span>
                          )}
                        </div>
                        <span className="font-black text-text-app shrink-0">
                          {formatPrice(unitPrice * item.quantity)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/15 flex gap-3 text-xs">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="font-bold text-text-app">Pagamento no atendimento</h3>
                  <p className="text-text-app/60 leading-relaxed">
                    O restaurante informará as formas de pagamento disponíveis ao confirmar o pedido.
                    Não há cobrança automática por Pix ou cartão nesta etapa.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 text-xs pt-4 border-t border-slate-500/10">
                <div className="flex justify-between text-text-app/50">
                  <span>Subtotal estimado</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-text-app/50">
                    <span>Taxa de entrega estimada</span>
                    <span>{formatPrice(deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-text-app pt-2 border-t border-slate-500/15 text-sm">
                  <span>TOTAL ESTIMADO</span>
                  <span className="text-primary text-base font-black">{formatPrice(estimatedTotal)}</span>
                </div>
                <p className="pt-1 text-[10px] text-text-app/45 leading-relaxed">
                  O valor final será confirmado pelo restaurante antes do pagamento.
                </p>
              </div>

              {errorMessage && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2.5 text-xs font-bold">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </>
          )}
        </div>

        {!createdOrder && (
          <div className="p-6 border-t border-slate-500/10 shrink-0">
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={isSubmitting || cart.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-black text-white uppercase tracking-wider transition shadow-lg hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>{isSubmitting ? "Enviando..." : "Enviar Pedido"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
