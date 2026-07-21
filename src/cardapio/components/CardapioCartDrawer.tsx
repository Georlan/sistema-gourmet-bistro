/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Product, ProductOption, BrandConfig, getProductImageUrl } from "../CardapioTypes";
import { X, Trash2, Plus, Minus, Send, ShoppingBag, MapPin, Ticket } from "lucide-react";


export interface CartItem {
  id: string; // generated combination of product ID + option choices
  product: Product;
  quantity: number;
  selectedOptions: Record<string, ProductOption[]>;
  notes: string;
}

interface CardapioCartDrawerProps {
  activeBrand: BrandConfig;
  cart: CartItem[];
  onClose: () => void;
  onUpdateQty: (itemId: string, newQty: number) => void;
  onRemoveItem: (itemId: string) => void;
  onPlaceOrder: (orderData: any) => void;
  user: any;
  onAuthClick: () => void;
}

export default function CardapioCartDrawer({
  activeBrand,
  cart,
  onClose,
  onUpdateQty,
  onRemoveItem,
  onPlaceOrder,
  user,
  onAuthClick
}: CardapioCartDrawerProps) {
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState(user?.address || "");
  const [paymentMethod, setPaymentMethod] = useState("Cartão de Crédito");
  const [promoCode, setPromoCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState(0); // value in BRL
  const [promoMessage, setPromoMessage] = useState("");

  const subtotal = cart.reduce((acc, item) => {
    let itemPrice = item.product.price;
    Object.values(item.selectedOptions).forEach((opts) => {
      opts.forEach((o) => {
        itemPrice += o.extraPrice;
      });
    });
    return acc + itemPrice * item.quantity;
  }, 0);

  const deliveryFee = deliveryMethod === "delivery" ? 7.00 : 0;
  const total = Math.max(0, subtotal + deliveryFee - appliedDiscount);

  const handleApplyPromo = () => {
    if (promoCode.toUpperCase() === "BEMVINDO") {
      setAppliedDiscount(10.00);
      setPromoMessage("Cupom de R$ 10,00 aplicado com sucesso! 🎉");
    } else if (promoCode.toUpperCase() === "FREE") {
      if (deliveryMethod === "delivery") {
        setAppliedDiscount(7.00);
        setPromoMessage("Entrega Grátis aplicada! 🛵");
      } else {
        setPromoMessage("Cupom válido apenas para entregas.");
      }
    } else if (promoCode.trim() !== "") {
      setPromoMessage("Cupom inválido ou expirado.");
      setAppliedDiscount(0);
    }
  };

  const handleCheckout = () => {
    if (!user) {
      alert("Por favor, faça login ou crie uma conta para finalizar o pedido.");
      onAuthClick();
      return;
    }

    if (deliveryMethod === "delivery" && !address.trim()) {
      alert("Por favor, informe o endereço de entrega.");
      return;
    }

    // Prepare order payload
    const orderItems = cart.map((item) => {
      const optionDetails: string[] = [];
      Object.entries(item.selectedOptions).forEach(([groupName, opts]) => {
        if (opts.length > 0) {
          optionDetails.push(`${opts.map((o) => o.name).join(", ")}`);
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

    const orderPayload = {
      id: "PED-" + Math.floor(1000 + Math.random() * 9000),
      brandId: activeBrand.id,
      brandName: activeBrand.name,
      items: orderItems,
      subtotal,
      deliveryFee,
      discount: appliedDiscount,
      total,
      deliveryMethod,
      address: deliveryMethod === "delivery" ? address : "Retirada no Balcão",
      paymentMethod,
      customerName: user.name,
      customerPhone: user.phone || "Não informado",
      status: "pending",
      createdAt: new Date().toISOString()
    };

    onPlaceOrder(orderPayload);
  };

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-40 flex justify-end bg-black/60 animate-fade-in cursor-pointer"
      id="cart-overlay"
    >
      {/* Drawer Card */}
      <div className="flex h-full w-full max-w-md flex-col bg-card-app border-l border-slate-500/10 shadow-2xl animate-slide-left" id="cart-drawer-container">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-500/10 p-4 shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold text-text-app">Seu Carrinho</h2>
            <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-semibold text-text-app/50">
              {cart.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-500/10 text-text-app/50 transition"
            id="btn-close-cart"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer Scrollable Content */}
        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-500/10 text-text-app/30">
              <ShoppingBag className="h-10 w-10" />
            </div>
            <h3 className="mt-4 font-display text-base font-bold text-text-app">Seu carrinho está vazio</h3>
            <p className="mt-1.5 text-xs text-text-app/40 max-w-[240px]">
              Navegue pelo nosso delicioso cardápio e adicione seus itens favoritos!
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-white transition hover:scale-105"
            >
              Voltar ao Cardápio
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-5 no-scrollbar">
            {/* Cart Items List */}
            <div className="space-y-3">
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
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-2xl border border-slate-500/10 bg-slate-500/5 p-3"
                    id={`cart-item-${item.id}`}
                  >
                    <img src={getProductImageUrl(item.product.image)} alt={item.product.name} className="h-14 w-14 rounded-xl object-cover shrink-0" />
                    
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-text-app truncate">{item.product.name}</h4>
                      {optionNames.length > 0 && (
                        <p className="mt-0.5 text-[10px] text-text-app/40 truncate leading-tight">
                          {optionNames.join(", ")}
                        </p>
                      )}
                      {item.notes && (
                        <p className="mt-1 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500 font-medium">
                          Obs: {item.notes}
                        </p>
                      )}
                      <span className="mt-1.5 block text-xs font-bold text-text-app">
                        {formatPrice(unitPrice * item.quantity)}
                      </span>
                    </div>

                    {/* Quantity Selector & Remove Button */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <button
                        onClick={() => onRemoveItem(item.id)}
                        className="text-text-app/30 hover:text-red-500 p-1"
                        title="Remover item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-1.5 rounded-full border border-slate-500/15 bg-card-app p-0.5">
                        <button
                          onClick={() => onUpdateQty(item.id, item.quantity - 1)}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-500/10 text-text-app/70 hover:bg-slate-500/20 text-[10px]"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-4 text-center text-xs font-bold text-text-app">{item.quantity}</span>
                        <button
                          onClick={() => onUpdateQty(item.id, item.quantity + 1)}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-500/10 text-text-app/70 hover:bg-slate-500/20 text-[10px]"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Delivery Method Selector */}
            <div className="rounded-2xl border border-slate-500/10 bg-slate-500/5 p-3">
              <h4 className="text-xs font-bold text-text-app">Como deseja receber seu pedido?</h4>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryMethod("delivery")}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold border transition ${
                    deliveryMethod === "delivery"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-500/10 bg-card-app text-text-app/50"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Delivery (Entrega)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMethod("pickup")}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold border transition ${
                    deliveryMethod === "pickup"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-500/10 bg-card-app text-text-app/50"
                  }`}
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>Retirar no Balcão</span>
                </button>
              </div>

              {/* Delivery Address Box */}
              {deliveryMethod === "delivery" && (
                <div className="mt-3">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-text-app/50">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    <span>Endereço de Entrega</span>
                  </div>
                  {user ? (
                    <input
                      type="text"
                      placeholder="Rua, número, complemento e bairro"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2.5 text-xs text-text-app focus:border-primary outline-hidden transition"
                      id="input-delivery-address"
                    />
                  ) : (
                    <p className="mt-1 text-[11px] text-amber-500 font-medium">
                      Faça login para salvar e usar seu endereço.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div className="rounded-2xl border border-slate-500/10 bg-slate-500/5 p-3">
              <h4 className="text-xs font-bold text-text-app">Forma de Pagamento</h4>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2.5 text-xs text-text-app focus:border-primary outline-hidden"
                id="select-payment"
              >
                <option value="Cartão de Crédito" className="bg-card-app text-text-app">Cartão de Crédito (na entrega)</option>
                <option value="Cartão de Débito" className="bg-card-app text-text-app">Cartão de Débito (na entrega)</option>
                <option value="PIX" className="bg-card-app text-text-app">PIX (Chave enviada no WhatsApp)</option>
                <option value="Dinheiro" className="bg-card-app text-text-app">Dinheiro / Troco</option>
              </select>
            </div>

            {/* Promo code input */}
            <div className="rounded-2xl border border-slate-500/10 bg-slate-500/5 p-3">
              <div className="flex items-center gap-1 text-xs font-bold text-text-app">
                <Ticket className="h-4 w-4 text-primary" />
                <span>Possui um cupom de desconto?</span>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Ex: BEMVINDO (R$ 10 off) ou FREE"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-500/10 bg-slate-500/5 p-2.5 text-xs uppercase text-text-app placeholder:normal-case focus:border-primary outline-hidden"
                />
                <button
                  onClick={handleApplyPromo}
                  className="rounded-xl bg-primary px-3.5 text-xs font-bold text-white hover:opacity-90 transition"
                >
                  Aplicar
                </button>
              </div>
              {promoMessage && (
                <p className="mt-1.5 text-[10px] font-semibold text-primary">{promoMessage}</p>
              )}
            </div>
          </div>
        )}

        {/* Drawer Sticky Footer Checkout */}
        {cart.length > 0 && (
          <div className="border-t border-slate-500/15 bg-card-app p-4 shadow-xl shrink-0 space-y-4">
            {/* Calculation details */}
            <div className="space-y-1 text-xs">
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
              {appliedDiscount > 0 && (
                <div className="flex justify-between text-green-500 font-semibold">
                  <span>Desconto Aplicado</span>
                  <span>- {formatPrice(appliedDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-text-app pt-2 border-t border-slate-500/15">
                <span>Total estimado</span>
                <span className="text-base text-primary">{formatPrice(total)}</span>
              </div>
            </div>

            {/* Actions: Send to Kitchen and Send to WhatsApp */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleCheckout}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition duration-150"
                id="btn-confirm-order"
              >
                <ShoppingBag className="h-4.5 w-4.5" />
                <span>Confirmar e Enviar para Cozinha</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
