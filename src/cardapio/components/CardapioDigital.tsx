/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { X, CheckCircle, ShoppingBag, Send, AlertCircle, Copy, Loader2, Check } from "lucide-react";
import { BrandConfig } from "../CardapioTypes";
import { CartItem } from "./CardapioCartDrawer";
import { supabase } from "../SupabaseClient";
import { API_BASE_URL } from "../../config/api";

interface CardapioDigitalProps {
  activeBrand: BrandConfig;
  cart: CartItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  deliveryMethod: "delivery" | "pickup";
  address: string;
  customerName: string;
  customerPhone: string;
  onClose: () => void;
  onOrderSuccess: (order: any) => void;
}

export default function CardapioDigital({
  activeBrand,
  cart,
  subtotal,
  deliveryFee,
  discount,
  total,
  deliveryMethod,
  address,
  customerName,
  customerPhone,
  onClose,
  onOrderSuccess
}: CardapioDigitalProps) {
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  // Profile and Cashback loyalty states
  const [profile, setProfile] = useState<any | null>(() => {
    const raw = localStorage.getItem("koma_cliente_perfil");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    const savedUser = localStorage.getItem("whitelabel_menu_current_user");
    if (savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch (e) {}
    }
    return null;
  });
  const [cashbackBalance, setCashbackBalance] = useState<number>(0);
  const [useCashback, setUseCashback] = useState<boolean>(false);

  useEffect(() => {
    if (!profile) return;
    const userPhone = profile.phone || profile.telefone;
    if (!userPhone) return;

    async function fetchCashback() {
      try {
        const { data: clientData } = await supabase
          .from("clientes")
          .select("*")
          .or(`telefone.eq.${userPhone},phone.eq.${userPhone}`)
          .maybeSingle();

        if (clientData) {
          const cb = Number(clientData.cashback !== undefined ? clientData.cashback : (clientData.saldo_cashback !== undefined ? clientData.saldo_cashback : 0));
          setCashbackBalance(cb);
        } else {
          setCashbackBalance(20.00); // R$ 20,00 default fallback
        }
      } catch (err) {
        console.warn("Erro ao buscar cashback:", err);
        setCashbackBalance(20.00); // R$ 20,00 default fallback
      }
    }
    fetchCashback();
  }, [profile]);

  const appliedCashback = useCashback ? Math.min(cashbackBalance, total) : 0;
  const finalTotal = Math.max(0, total - appliedCashback);
  const accumulatedCashback = subtotal * 0.05; // 5% reward on subtotal

  // Pix state fields
  const [pixOrderId, setPixOrderId] = useState<string>("");
  const [pixCode, setPixCode] = useState<string>("");
  const [pixCountdown, setPixCountdown] = useState<number>(600); // 10 minutes (600 seconds)
  const [isPixWaiting, setIsPixWaiting] = useState<boolean>(false);
  const [isPixPaid, setIsPixPaid] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  };

  // Pix Timer logic
  useEffect(() => {
    let timerId: any;
    if (isPixWaiting && pixCountdown > 0) {
      timerId = setInterval(() => {
        setPixCountdown((prev) => prev - 1);
      }, 1000);
    } else if (pixCountdown === 0 && isPixWaiting) {
      setErrorMessage("O tempo limite para pagamento do Pix expirou. Por favor, tente novamente.");
      setIsPixWaiting(false);
    }
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [isPixWaiting, pixCountdown]);

  // Pix Polling logic
  useEffect(() => {
    let intervalId: any;
    if (isPixWaiting && pixOrderId) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`/api/pedidos/${pixOrderId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.order && data.order.status === "RECEBIDO") {
              setIsPixWaiting(false);
              setIsPixPaid(true);
              clearInterval(intervalId);
            }
          }
        } catch (err) {
          console.error("Erro no polling de status Pix:", err);
        }
      }, 3000); // Poll every 3 seconds
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPixWaiting, pixOrderId]);

  const isSubmittingRef = useRef(false);

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");

    const cleanedItems = cart.map((item) => {
      const optionDetails: string[] = [];
      Object.entries(item.selectedOptions).forEach(([groupName, opts]) => {
        if (opts.length > 0) {
          optionDetails.push(`${opts.map((o) => o.name).join(", ")}`);
        }
      });

      const observacoes = [
        item.notes,
        optionDetails.length > 0 ? `Opções: ${optionDetails.join(" | ")}` : ""
      ].filter(Boolean).join(" - ");

      return {
        produto_id: item.product.id,
        quantidade: item.quantity,
        observacao: observacoes,
        cliente_nome: customerName
      };
    });

    const orderPayload = {
      restaurante_id: Number(activeBrand.id) || 1,
      itens: cleanedItems,
      cliente_nome: customerName,
      cliente_telefone: customerPhone,
      endereco_entrega: deliveryMethod === "delivery" ? address : "Retirada no Balcão",
      taxa_entrega: Number(deliveryFee) || 0,
      forma_pagamento: paymentMethod === "PIX" ? "Pix" : paymentMethod,
      tipo_pedido: deliveryMethod === "delivery" ? "delivery" : "retirada",
      idempotency_key: `cardapio-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    };

    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/pedidos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(orderPayload)
      });

      if (!response.ok) {
        throw new Error(`Falha no envio do pedido (${response.status})`);
      }

      const data = await response.json();
      if (data.success || data.status === "success") {
        const userPhone = profile?.phone || profile?.telefone;
        if (userPhone) {
          try {
            const remainingCashback = useCashback ? Math.max(0, cashbackBalance - appliedCashback) : cashbackBalance;
            const newCashback = remainingCashback + accumulatedCashback;

            // Cashback e saldos de fidelidade são processados exclusivamente no backend por segurança
            const updatedProfile = { 
              ...profile, 
              cashback: newCashback, 
              saldo_cashback: newCashback 
            };
            localStorage.setItem("koma_cliente_perfil", JSON.stringify(updatedProfile));
            localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(updatedProfile));
          } catch (e) {
            console.warn("Erro ao atualizar visualização de cashback pós-pedido:", e);
          }
        }

        if (paymentMethod === "PIX") {
          setPixOrderId(data.orderId);
          setPixCode(data.pixCode || "Chave Pix Simulado Copia e Cola");
          setPixCountdown(600);
          setIsPixWaiting(true);
        } else {
          setIsSuccess(true);
        }
      } else {
        throw new Error(data.message || "Falha ao processar pedido");
      }
    } catch (err: any) {
      console.error("Erro ao enviar pedido para o backend:", err);
      setErrorMessage(err.message || "Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCopyPixCode = () => {
    if (!pixCode) return;
    navigator.clipboard.writeText(pixCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulatePayment = async () => {
    if (!pixOrderId || isSimulating) return;
    setIsSimulating(true);
    try {
      const res = await fetch("/api/webhooks/pix-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ orderId: pixOrderId })
      });
      const data = await res.json();
      if (data.success) {
        setIsPixWaiting(false);
        setIsPixPaid(true);
      } else {
        alert("Falha na simulação: " + data.message);
      }
    } catch (err) {
      console.error(err);
      alert("Erro na simulação do pagamento.");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleFinish = () => {
    onOrderSuccess(null);
  };

  // Convert seconds remaining to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
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
        {/* Header (Hidden on waiting Pix screen to keep it ultra-clean and immersive) */}
        {!isPixWaiting && !isPixPaid && !isSuccess && (
          <div className="flex items-center justify-between p-6 border-b border-slate-500/10 shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" />
              <h2 className="font-display font-extrabold text-sm sm:text-base uppercase tracking-wider text-text-app">
                Finalizar Pedido
              </h2>
            </div>
            
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-500/10 text-text-app/50 transition cursor-pointer"
              id="btn-close-checkout"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6 no-scrollbar">
          {/* STATE 1: WAITING PIX PAYMENT */}
          {isPixWaiting ? (
            <div className="py-4 flex flex-col items-center justify-center text-center space-y-6 animate-scale-up">
              {/* Header Title */}
              <div className="space-y-1">
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[10px] font-bold text-amber-500 uppercase tracking-widest inline-block animate-pulse">
                  ⚡ Aguardando Pagamento Pix
                </span>
                <h3 className="font-display font-black text-xl text-text-app pt-2">
                  Quase lá! Escaneie o QR Code abaixo
                </h3>
                <p className="text-xs text-text-app/60 max-w-sm mx-auto leading-relaxed">
                  Para concluir o seu pedido, realize o pagamento via Pix. O pedido será enviado automaticamente para a cozinha após a confirmação.
                </p>
              </div>

              {/* Countdown timer badge */}
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-500/5 rounded-full border border-slate-500/10 shrink-0">
                <span className="text-[10px] uppercase font-bold text-text-app/50">O Pix expira em:</span>
                <span className="font-mono text-base font-extrabold text-primary animate-pulse">
                  {formatTime(pixCountdown)}
                </span>
              </div>

              {/* Interactive Vector SVG QR Code mockup */}
              <div className="relative p-4 bg-white rounded-3xl shadow-md border border-slate-500/10 flex items-center justify-center shrink-0">
                <svg className="w-40 h-40" viewBox="0 0 100 100">
                  {/* QR Code pattern blocks */}
                  <rect x="5" y="5" width="25" height="25" fill="#1e293b" />
                  <rect x="10" y="10" width="15" height="15" fill="white" />
                  <rect x="13" y="13" width="9" height="9" fill="#1e293b" />
                  
                  <rect x="70" y="5" width="25" height="25" fill="#1e293b" />
                  <rect x="75" y="10" width="15" height="15" fill="white" />
                  <rect x="78" y="13" width="9" height="9" fill="#1e293b" />
                  
                  <rect x="5" y="70" width="25" height="25" fill="#1e293b" />
                  <rect x="10" y="75" width="15" height="15" fill="white" />
                  <rect x="13" y="78" width="9" height="9" fill="#1e293b" />
                  
                  {/* Random pattern dots */}
                  <rect x="35" y="5" width="5" height="5" fill="#334155" />
                  <rect x="45" y="10" width="10" height="5" fill="#334155" />
                  <rect x="60" y="5" width="5" height="10" fill="#334155" />
                  <rect x="35" y="20" width="15" height="5" fill="#334155" />
                  <rect x="55" y="20" width="5" height="15" fill="#334155" />
                  
                  <rect x="5" y="35" width="5" height="15" fill="#334155" />
                  <rect x="15" y="45" width="15" height="5" fill="#334155" />
                  <rect x="5" y="55" width="15" height="5" fill="#334155" />
                  <rect x="25" y="35" width="5" height="15" fill="#334155" />
                  
                  <rect x="70" y="35" width="15" height="5" fill="#334155" />
                  <rect x="80" y="45" width="15" height="10" fill="#334155" />
                  <rect x="70" y="60" width="5" height="5" fill="#334155" />
                  <rect x="90" y="60" width="5" height="15" fill="#334155" />
                  
                  <rect x="35" y="70" width="15" height="5" fill="#334155" />
                  <rect x="40" y="80" width="5" height="15" fill="#334155" />
                  <rect x="50" y="75" width="15" height="5" fill="#334155" />
                  <rect x="60" y="85" width="10" height="10" fill="#334155" />
                  
                  {/* Center Pix Logo badge */}
                  <rect x="40" y="40" width="20" height="20" rx="4" fill="#32bcad" />
                  <path d="M45 50 L50 45 L55 50 L50 55 Z" fill="white" />
                </svg>
              </div>

              {/* Copia e Cola field */}
              <div className="w-full max-w-sm space-y-2">
                <label className="text-[9px] font-extrabold uppercase text-text-app/40 block text-left">Código Pix Copia e Cola</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={pixCode}
                    className="flex-1 text-xs p-3 rounded-xl bg-slate-500/5 border border-slate-500/10 text-text-app font-mono truncate select-all"
                  />
                  <button
                    onClick={handleCopyPixCode}
                    className="px-4 bg-primary text-white rounded-xl flex items-center justify-center hover:opacity-90 active:scale-95 transition"
                    title="Copiar Código Pix"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                {copied && (
                  <p className="text-[10px] font-bold text-emerald-500 text-left animate-pulse">✓ Código copiado para a área de transferência!</p>
                )}
              </div>

              {/* Discrete synchronization loader */}
              <div className="flex items-center gap-2 text-xs font-semibold text-text-app/50 bg-slate-500/5 px-4 py-2.5 rounded-full border border-slate-500/10 animate-pulse">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                <span>Sincronizando com o banco, aguardando pagamento...</span>
              </div>

              {/* Developer helper sim card */}
              <div className="p-4 w-full max-w-sm rounded-2xl bg-amber-500/5 border border-amber-500/10 flex flex-col items-center gap-2">
                <span className="text-[9px] font-extrabold text-amber-500 uppercase tracking-widest">Apenas na demonstração (Webhook)</span>
                <p className="text-[10px] text-text-app/50">Você pode simular o recebimento do webhook de pagamento Pix clicando no botão abaixo:</p>
                <button
                  onClick={handleSimulatePayment}
                  disabled={isSimulating}
                  className="w-full py-2 bg-amber-500 text-slate-950 font-black text-[10px] rounded-xl hover:opacity-95 active:scale-[0.98] transition uppercase tracking-wide flex items-center justify-center gap-1.5"
                >
                  {isSimulating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Confirmando...</span>
                    </>
                  ) : (
                    <span>Confirmar Pagamento Simulado</span>
                  )}
                </button>
              </div>
            </div>
          ) : isPixPaid || isSuccess ? (
            /* STATE 2: PAYMENT OR ORDER CONFIRMED SUCCESS SCREEN */
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4 animate-scale-up">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                <CheckCircle className="h-10 w-10 animate-bounce" />
              </div>

              <div className="space-y-2 max-w-md">
                <h3 className="font-display font-black text-xl text-emerald-500">
                  {isPixPaid ? "Pagamento Confirmado! 🎉" : "Pedido Enviado com Sucesso! 🎉"}
                </h3>
                <p className="text-xs text-text-app/70 leading-relaxed">
                  Obrigado, <strong className="text-text-app">{customerName}</strong>! Seu pedido <strong className="text-primary font-mono">{pixOrderId || "REGISTRADO"}</strong> já foi recebido em nossa cozinha e já está sendo preparado com muito carinho.
                </p>
                
                <div className="p-3 bg-slate-500/5 rounded-2xl border border-slate-500/10 text-[11px] text-primary font-bold">
                  📱 Você receberá todas as atualizações de status diretamente no seu WhatsApp!
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="w-full max-w-xs py-3.5 mt-4 bg-primary text-white text-xs font-black rounded-xl shadow-md hover:opacity-95 transition uppercase tracking-wider cursor-pointer"
              >
                Voltar ao Cardápio
              </button>
            </div>
          ) : (
            /* STATE 3: CHECKOUT SELECTION AND REVIEWS */
            <>
              {/* Customer and Delivery info summary */}
              <div className="p-4 rounded-2xl bg-slate-500/5 border border-slate-500/10 space-y-2 text-xs">
                <h3 className="font-bold text-text-app/90 text-xs uppercase tracking-wider">Dados de Entrega</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-app/70 leading-relaxed">
                  <p>👤 <strong className="text-text-app">Cliente:</strong> {customerName}</p>
                  <p>📞 <strong className="text-text-app">Telefone:</strong> {customerPhone}</p>
                </div>
                <p className="text-text-app/70 leading-relaxed">
                  📍 <strong className="text-text-app">Destino:</strong> {deliveryMethod === "delivery" ? address : "Retirada no Balcão"}
                </p>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h3 className="font-bold text-text-app/90 text-[10px] uppercase tracking-wider">Resumo dos Itens</h3>
                <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1 no-scrollbar">
                  {cart.map((item) => {
                    let unitPrice = item.product.price;
                    const optionNames: string[] = [];
                    Object.values(item.selectedOptions).forEach((opts) => {
                      opts.forEach((o) => {
                        unitPrice += o.extraPrice;
                        optionNames.push(o.name);
                      });
                    });

                    return (
                      <div key={item.id} className="p-3 bg-slate-500/5 border border-slate-500/10 rounded-xl flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-3">
                          <span className="font-bold text-text-app block truncate">{item.quantity}x {item.product.name}</span>
                          {optionNames.length > 0 && (
                            <span className="block text-[10px] text-text-app/40 truncate mt-0.5">{optionNames.join(", ")}</span>
                          )}
                        </div>
                        <span className="font-black text-text-app shrink-0">{formatPrice(unitPrice * item.quantity)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* GATILHO DE CASHBACK NO CHECKOUT */}
              {cashbackBalance > 0 && (
                <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 space-y-2 text-xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-extrabold text-emerald-400 uppercase tracking-wider block">Saldo de Fidelidade Kôma</span>
                    <h4 className="font-bold text-white">Usar {formatPrice(cashbackBalance)} do meu saldo de Cashback?</h4>
                    <p className="text-[10px] text-slate-400">Ative para subtrair este valor do total do pedido.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseCashback(!useCashback)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                      useCashback ? "bg-emerald-500" : "bg-slate-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        useCashback ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Payment selector */}
              <div className="space-y-3">
                <h3 className="font-bold text-text-app/90 text-xs uppercase tracking-wider">Forma de Pagamento</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { id: "PIX", title: "PIX", subtitle: "Aguardar compensação automática" },
                    { id: "CREDIT_CARD", title: "Cartão de Crédito", subtitle: "Pagar na entrega" },
                    { id: "DEBIT_CARD", title: "Cartão de Débito", subtitle: "Pagar na entrega" },
                    { id: "CASH", title: "Dinheiro / Troco", subtitle: "Pagar na entrega" }
                  ].map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setPaymentMethod(method.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition cursor-pointer ${
                        paymentMethod === method.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-slate-500/10 bg-slate-500/5 hover:bg-slate-500/10 text-text-app/70"
                      }`}
                    >
                      <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                        {method.id === "PIX" ? "PX" : "CD"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-app truncate">{method.title}</p>
                        <p className="text-[10px] text-text-app/40 truncate mt-0.5">{method.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Total Calculation breakdown */}
              <div className="space-y-1.5 text-xs pt-4 border-t border-slate-500/10">
                <div className="flex justify-between text-text-app/50">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-text-app/50">
                    <span>Taxa de Entrega</span>
                    <span>{formatPrice(deliveryFee)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-primary font-semibold">
                    <span>Desconto</span>
                    <span>-{formatPrice(discount)}</span>
                  </div>
                )}
                {useCashback && (
                  <div className="flex justify-between text-emerald-400 font-bold">
                    <span>Saldo de Cashback Utilizado</span>
                    <span>-{formatPrice(appliedCashback)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-text-app pt-2 border-t border-slate-500/15 text-sm">
                  <span>TOTAL ESTIMADO</span>
                  <span className="text-primary text-base font-black">{formatPrice(finalTotal)}</span>
                </div>

                {/* RECOMPENSA VISUAL NO CHECKOUT (REFORÇO POSITIVO) */}
                <div className="text-center pt-2 border-t border-slate-500/10">
                  <p className="text-[11px] font-bold text-emerald-400 flex items-center justify-center gap-1">
                    <span>✨ Você acumulará +{formatPrice(accumulatedCashback)} de cashback com esta compra!</span>
                  </p>
                </div>
              </div>

              {/* Error Alert Box */}
              {errorMessage && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl flex items-center gap-2.5 text-xs font-bold animate-pulse">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {!isPixWaiting && !isPixPaid && !isSuccess && (
          <div className="p-6 border-t border-slate-500/10 shrink-0">
            <button
              onClick={handlePlaceOrder}
              disabled={isSubmitting || cart.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-black text-white uppercase tracking-wider transition shadow-lg hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>{isSubmitting ? "Processando e Enviando..." : "Enviar Pedido Real"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
