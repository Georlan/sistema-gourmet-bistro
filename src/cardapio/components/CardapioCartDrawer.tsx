/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { 
  Product, 
  ProductOption, 
  BrandConfig, 
  BairroTaxa,
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
  Minus,
  Percent,
  Phone,
  Plus,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  Truck,
  UserRound,
  X,
  CreditCard,
  QrCode,
  Banknote,
} from "lucide-react";
import { formatBrazilianPhone, normalizeBrazilianPhone } from "../customerSession";
import { API_BASE_URL } from "../../config/api";

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  selectedOptions: Record<string, ProductOption[]>;
  notes: string;
}

export interface CardapioCheckoutRequest {
  deliveryMethod: "delivery" | "pickup";
  address: string;
  deliveryFee: number;
  customerName: string;
  customerPhone: string;
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

const guestContactKey = (restaurantId: string | number) =>
  `koma_guest_checkout:${String(restaurantId)}`;

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
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("pickup");
  const [address, setAddress] = useState(user?.address || "");
  const [selectedBairro, setSelectedBairro] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Payment detail & Change (Troco)
  const [paymentDetail, setPaymentDetail] = useState<"pix" | "dinheiro" | "cartao_credito" | "cartao_debito">("pix");
  const [trocoPara, setTrocoPara] = useState<string>("");
  const [precisaTroco, setPrecisaTroco] = useState(false);

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
    if (user) {
      setGuestName(user.name || "");
      setGuestPhone(formatBrazilianPhone(user.phone || ""));
      if (user.address) setAddress(user.address);
      return;
    }

    try {
      const raw = localStorage.getItem(guestContactKey(restaurantId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { name?: string; phone?: string; address?: string };
      setGuestName(String(parsed.name || ""));
      setGuestPhone(formatBrazilianPhone(String(parsed.phone || "")));
      setAddress(String(parsed.address || ""));
    } catch {
      // Ignore
    }
  }, [restaurantId, user]);

  useEffect(() => {
    if (user) return;
    try {
      localStorage.setItem(guestContactKey(restaurantId), JSON.stringify({
        name: guestName.trim(),
        phone: normalizeBrazilianPhone(guestPhone),
        address: address.trim(),
      }));
    } catch {
      // Ignore
    }
  }, [address, guestName, guestPhone, restaurantId, user]);

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

  // Delivery Fee Calculation based on Bairro and Free Delivery rules
  const deliveryFee = useMemo(() => {
    if (deliveryMethod !== "delivery") return 0;

    // Check free shipping threshold
    const freteGratis = brandConfig?.freteGratisValor || 0;
    if (freteGratis > 0 && subtotal >= freteGratis) {
      return 0;
    }

    // Check neighborhood fee
    if (selectedBairro && brandConfig?.tabelaTaxasBairros?.length) {
      const found = brandConfig.tabelaTaxasBairros.find(
        (b) => b.bairro.toLowerCase() === selectedBairro.toLowerCase()
      );
      if (found) return found.taxa;
    }

    return brandConfig?.taxaEntregaPadrao ?? 7;
  }, [deliveryMethod, brandConfig, subtotal, selectedBairro]);

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
      .filter((p) => !cartProductIds.has(p.id) && p.isAvailable !== false)
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

  const customerName = user?.name || guestName;
  const customerPhone = user?.phone || normalizeBrazilianPhone(guestPhone);

  const handleCheckout = () => {
    setErrorMessage("");

    if (!orderingEnabled) {
      setErrorMessage(orderingMessage);
      return;
    }
    if (cart.length === 0) {
      setErrorMessage("Sua sacola está vazia.");
      return;
    }

    // Check minimum order
    const pedidoMin = brandConfig?.pedidoMinimo || 0;
    if (pedidoMin > 0 && subtotal < pedidoMin) {
      setErrorMessage(`O pedido mínimo para entrega é de ${formatPrice(pedidoMin)} (faltam ${formatPrice(pedidoMin - subtotal)}).`);
      return;
    }

    if (customerName.trim().length < 2) {
      setErrorMessage("Informe seu nome para o restaurante identificar o pedido.");
      return;
    }
    if (normalizeBrazilianPhone(customerPhone).length < 10) {
      setErrorMessage("Informe um celular válido com DDD.");
      return;
    }
    if (deliveryMethod === "delivery" && address.trim().length < 5) {
      setErrorMessage("Informe onde o pedido deve ser entregue.");
      return;
    }

    if (paymentDetail === "dinheiro" && precisaTroco && trocoValorNum < total) {
      setErrorMessage(`O valor para troco deve ser maior que o total do pedido (${formatPrice(total)}).`);
      return;
    }

    onPlaceOrder({
      deliveryFee,
      deliveryMethod,
      address: deliveryMethod === "delivery" 
        ? (selectedBairro ? `${address.trim()}, ${selectedBairro}` : address.trim())
        : "Retirada no Balcão",
      customerName: customerName.trim(),
      customerPhone: normalizeBrazilianPhone(customerPhone),
      paymentMethodDetail: paymentDetail,
      trocoPara: precisaTroco && trocoValorNum > 0 ? trocoValorNum : undefined,
      bairro: selectedBairro || undefined,
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
      className="fixed inset-0 z-40 flex items-end justify-end bg-black/65 sm:items-stretch animate-fade-in cursor-pointer"
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
          <div className="flex flex-1 flex-col items-center justify-start p-6 text-center overflow-y-auto no-scrollbar">
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
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 no-scrollbar">
              {/* Status Alert */}
              {!orderingEnabled && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] font-semibold leading-relaxed text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{orderingMessage}</span>
                </div>
              )}

              {/* Free Delivery Banner Progress */}
              {brandConfig?.freteGratisValor && brandConfig.freteGratisValor > 0 && deliveryMethod === "delivery" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs">
                  {subtotal >= brandConfig.freteGratisValor ? (
                    <div className="flex items-center gap-2 text-emerald-400 font-bold">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>Parabéns! Você ganhou Frete Grátis neste pedido!</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-semibold text-koma-foreground mb-1.5">
                        <span>Adicione mais <strong>{formatPrice(brandConfig.freteGratisValor - subtotal)}</strong></span>
                        <span className="text-emerald-400 font-bold">Frete Grátis</span>
                      </div>
                      <div className="w-full h-1.5 bg-koma-card rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (subtotal / brandConfig.freteGratisValor) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 1: Cart Items */}
              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">1. Seu pedido</h3>
                  <span className="text-[10px] font-bold text-koma-subtle">{itemCount} {itemCount === 1 ? "item" : "itens"}</span>
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
                      <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-koma-border bg-koma-card p-3" id={`cart-item-${item.id}`}>
                        <img
                          src={getProductImageUrl(item.product.image)}
                          alt={item.product.name}
                          className="h-14 w-14 shrink-0 rounded-xl object-cover"
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-xs font-black text-koma-foreground">{item.product.name}</h4>
                          {optionNames.length > 0 && <p className="mt-0.5 truncate text-[10px] text-koma-muted">{optionNames.join(", ")}</p>}
                          {item.notes && <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-amber-500">Obs.: {item.notes}</p>}
                          <strong className="mt-2 block text-xs text-emerald-500">{formatPrice(unitPrice * item.quantity)}</strong>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
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
                    <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Que tal adicionar?</h3>
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

              {/* Section 2: Delivery Method & Address & Bairro */}
              <section className="border-t border-koma-border pt-5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">2. Como quer receber?</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setDeliveryMethod("pickup"); setErrorMessage(""); }} className={`rounded-2xl border p-3 text-left transition ${deliveryMethod === "pickup" ? "border-emerald-500/45 bg-emerald-500/10" : "border-koma-border bg-koma-card hover:border-emerald-500/25"}`}>
                    <ShoppingBag className={deliveryMethod === "pickup" ? "h-4 w-4 text-emerald-500" : "h-4 w-4 text-koma-muted"} />
                    <strong className="mt-2 block text-xs text-koma-foreground">Retirada</strong>
                    <span className="mt-0.5 block text-[9px] text-koma-muted">{restaurantAddress ? `Buscar em ${restaurantAddress}` : "Buscar no restaurante"}</span>
                  </button>
                  <button type="button" onClick={() => { setDeliveryMethod("delivery"); setErrorMessage(""); }} className={`rounded-2xl border p-3 text-left transition ${deliveryMethod === "delivery" ? "border-emerald-500/45 bg-emerald-500/10" : "border-koma-border bg-koma-card hover:border-emerald-500/25"}`}>
                    <Truck className={deliveryMethod === "delivery" ? "h-4 w-4 text-emerald-500" : "h-4 w-4 text-koma-muted"} />
                    <strong className="mt-2 block text-xs text-koma-foreground">Delivery</strong>
                    <span className="mt-0.5 block text-[9px] text-koma-muted">
                      {deliveryFee === 0 ? "Frete Grátis" : `Taxa de ${formatPrice(deliveryFee)}`}
                    </span>
                  </button>
                </div>

                {deliveryMethod === "delivery" && (
                  <div className="mt-3 space-y-2.5">
                    {/* Bairro Selector if configured */}
                    {brandConfig?.tabelaTaxasBairros && brandConfig.tabelaTaxasBairros.length > 0 && (
                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Selecione o Bairro</span>
                        <select
                          value={selectedBairro}
                          onChange={(e) => setSelectedBairro(e.target.value)}
                          className="w-full h-11 px-3 bg-koma-card border border-koma-border rounded-xl text-xs text-koma-foreground outline-none focus:border-emerald-500"
                        >
                          <option value="">Selecione seu bairro...</option>
                          {brandConfig.tabelaTaxasBairros.map((b) => (
                            <option key={b.bairro} value={b.bairro}>
                              {b.bairro} ({b.taxa === 0 ? 'Grátis' : formatPrice(b.taxa)})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-koma-muted"><MapPin className="h-3.5 w-3.5 text-emerald-500" /> Endereço de entrega</span>
                      <textarea rows={3} placeholder="Rua, número, complemento e bairro" value={address} onChange={(event) => { setAddress(event.target.value); if (errorMessage) setErrorMessage(""); }} className="w-full resize-none rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500" id="input-delivery-address" />
                    </label>
                  </div>
                )}
              </section>

              {/* Section 3: Cupons & Descontos */}
              <section className="border-t border-koma-border pt-5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted mb-2.5">3. Descontos & Benefícios</h3>
                
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
              <section className="border-t border-koma-border pt-5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted mb-2.5">4. Pagamento (na entrega/retirada)</h3>
                
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPaymentDetail("pix"); setPrecisaTroco(false); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                      paymentDetail === "pix"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold"
                        : "border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground"
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    <span className="text-[11px]">Pix</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setPaymentDetail("cartao_credito"); setPrecisaTroco(false); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                      paymentDetail === "cartao_credito"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold"
                        : "border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground"
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span className="text-[11px]">Cartão</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentDetail("dinheiro")}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                      paymentDetail === "dinheiro"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold"
                        : "border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground"
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span className="text-[11px]">Dinheiro</span>
                  </button>
                </div>

                {/* Troco Calculator for Dinheiro */}
                {paymentDetail === "dinheiro" && (
                  <div className="mt-3 p-3 bg-koma-card border border-koma-border rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-koma-foreground">Precisa de troco?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPrecisaTroco(false)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold ${!precisaTroco ? 'bg-emerald-500 text-white' : 'bg-koma-raised text-koma-muted'}`}
                        >
                          Não
                        </button>
                        <button
                          type="button"
                          onClick={() => setPrecisaTroco(true)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold ${precisaTroco ? 'bg-emerald-500 text-white' : 'bg-koma-raised text-koma-muted'}`}
                        >
                          Sim
                        </button>
                      </div>
                    </div>

                    {precisaTroco && (
                      <div className="space-y-2 pt-2 border-t border-koma-border/60">
                        <span className="block text-[10px] text-koma-muted">Troco para quanto?</span>
                        <div className="flex gap-2">
                          {[50, 100, 200].map((val) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setTrocoPara(String(val))}
                              className={`flex-1 py-1.5 rounded-lg border text-xs font-mono font-bold transition ${
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
                            step="0.01"
                            placeholder="Outro valor..."
                            value={trocoPara}
                            onChange={(e) => setTrocoPara(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-koma-raised border border-koma-border rounded-xl text-xs font-mono font-bold text-koma-foreground outline-none focus:border-emerald-500"
                          />
                        </div>
                        {trocoCalculado > 0 && (
                          <div className="flex justify-between text-xs pt-1 text-emerald-400 font-bold">
                            <span>Levar troco de:</span>
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
                <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">5. Identificação</h3>
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
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Seu nome</span>
                      <span className="relative block"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="text" autoComplete="name" maxLength={100} placeholder="Como devemos chamar você?" value={guestName} onChange={(event) => { setGuestName(event.target.value); if (errorMessage) setErrorMessage(""); }} className="h-12 w-full rounded-xl border border-koma-border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500" id="input-guest-name" /></span>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Celular com DDD</span>
                      <span className="relative block"><Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="tel" inputMode="numeric" autoComplete="tel" placeholder="(00) 00000-0000" value={guestPhone} onChange={(event) => { setGuestPhone(formatBrazilianPhone(event.target.value)); if (errorMessage) setErrorMessage(""); }} className="h-12 w-full rounded-xl border border-koma-border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500" id="input-guest-phone" /></span>
                    </label>
                    {onAuthClick && <button type="button" onClick={onAuthClick} className="text-left text-[10px] font-semibold leading-relaxed text-koma-muted transition hover:text-emerald-500">Quer acumular pontos de fidelidade? <strong className="text-emerald-500">Identifique-se aqui.</strong></button>}
                  </div>
                )}
              </section>

              {errorMessage && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] font-semibold text-rose-400" role="alert">
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
                <div className="flex justify-between border-t border-koma-border pt-2 text-sm font-black text-koma-foreground">
                  <span>Total final</span>
                  <span className="text-base text-emerald-500">{formatPrice(total)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCheckout}
                disabled={!orderingEnabled}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-koma-raised disabled:text-koma-muted"
                id="btn-confirm-order"
              >
                <span>{orderingEnabled ? "Revisar pedido" : "Pedidos pausados"}</span>
                {orderingEnabled && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
