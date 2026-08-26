/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { Product, ProductOption, getProductImageUrl, LOCAL_PRODUCT_PLACEHOLDER } from "../CardapioTypes";
import { AlertCircle, ArrowRight, MapPin, Minus, Plus, ShoppingBag, Trash2, Truck, UserRound, X } from "lucide-react";

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
}

interface CardapioCartDrawerProps {
  cart: CartItem[];
  onClose: () => void;
  onUpdateQty: (itemId: string, newQty: number) => void;
  onRemoveItem: (itemId: string) => void;
  onPlaceOrder: (orderData: CardapioCheckoutRequest) => void;
  user: any;
  onAuthClick: () => void;
}

const formatPrice = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(value);

export default function CardapioCartDrawer({
  cart,
  onClose,
  onUpdateQty,
  onRemoveItem,
  onPlaceOrder,
  user,
  onAuthClick,
}: CardapioCartDrawerProps) {
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState(user?.address || "");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (user?.address && !address.trim()) setAddress(user.address);
  }, [user?.address, address]);

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
  const deliveryFee = deliveryMethod === "delivery" ? 7 : 0;
  const total = subtotal + deliveryFee;

  const handleCheckout = () => {
    setErrorMessage("");

    if (!user) {
      onAuthClick();
      return;
    }

    if (deliveryMethod === "delivery" && address.trim().length < 5) {
      setErrorMessage("Informe onde o pedido deve ser entregue.");
      return;
    }

    onPlaceOrder({
      deliveryFee,
      deliveryMethod,
      address: deliveryMethod === "delivery" ? address.trim() : "Retirada no Balcão",
      customerName: user.name,
      customerPhone: user.phone || "",
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
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] border border-koma-border bg-koma-panel shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-[28px] sm:border-y-0 sm:border-r-0 animate-slide-left"
        id="cart-drawer-container"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-koma-border px-4 py-3.5 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-emerald-500" />
              <h2 className="font-display text-base font-black text-koma-foreground">Sua sacola</h2>
              {itemCount > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-500">{itemCount}</span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-koma-muted">Revise os itens e escolha como quer receber.</p>
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
          <div className="flex flex-1 flex-col items-center justify-center p-7 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-koma-border bg-koma-card text-koma-muted">
              <ShoppingBag className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-sm font-black text-koma-foreground">Escolha algo gostoso primeiro</h3>
            <p className="mt-1.5 max-w-[250px] text-xs leading-relaxed text-koma-muted">
              Seus itens ficam guardados aqui enquanto você continua navegando pelo cardápio.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-5 py-2.5 text-xs font-black text-emerald-500"
            >
              Voltar ao cardápio
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 no-scrollbar">
              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Itens do pedido</h3>
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
                      <div
                        key={item.id}
                        className="flex items-start gap-3 rounded-2xl border border-koma-border bg-koma-card p-3"
                        id={`cart-item-${item.id}`}
                      >
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
                          {optionNames.length > 0 && (
                            <p className="mt-0.5 truncate text-[10px] text-koma-muted">{optionNames.join(", ")}</p>
                          )}
                          {item.notes && (
                            <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-amber-500">Obs.: {item.notes}</p>
                          )}
                          <strong className="mt-2 block text-xs text-emerald-500">{formatPrice(unitPrice * item.quantity)}</strong>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.id)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-koma-subtle transition hover:bg-rose-500/10 hover:text-rose-400"
                            aria-label={`Remover ${item.product.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <div className="flex items-center rounded-xl border border-koma-border bg-koma-panel p-0.5">
                            <button
                              type="button"
                              onClick={() => onUpdateQty(item.id, item.quantity - 1)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised"
                              aria-label={`Diminuir ${item.product.name}`}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-7 text-center text-xs font-black text-koma-foreground">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => onUpdateQty(item.id, item.quantity + 1)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised"
                              aria-label={`Aumentar ${item.product.name}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="border-t border-koma-border pt-5">
                <h3 className="text-sm font-black text-koma-foreground">Como quer receber?</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeliveryMethod("delivery");
                      setErrorMessage("");
                    }}
                    className={`rounded-2xl border p-3 text-left transition ${
                      deliveryMethod === "delivery"
                        ? "border-emerald-500/45 bg-emerald-500/10"
                        : "border-koma-border bg-koma-card hover:border-emerald-500/25"
                    }`}
                  >
                    <Truck className={deliveryMethod === "delivery" ? "h-4 w-4 text-emerald-500" : "h-4 w-4 text-koma-muted"} />
                    <strong className="mt-2 block text-xs text-koma-foreground">Entrega</strong>
                    <span className="mt-0.5 block text-[9px] text-koma-muted">Taxa estimada de {formatPrice(7)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeliveryMethod("pickup");
                      setErrorMessage("");
                    }}
                    className={`rounded-2xl border p-3 text-left transition ${
                      deliveryMethod === "pickup"
                        ? "border-emerald-500/45 bg-emerald-500/10"
                        : "border-koma-border bg-koma-card hover:border-emerald-500/25"
                    }`}
                  >
                    <ShoppingBag className={deliveryMethod === "pickup" ? "h-4 w-4 text-emerald-500" : "h-4 w-4 text-koma-muted"} />
                    <strong className="mt-2 block text-xs text-koma-foreground">Retirada</strong>
                    <span className="mt-0.5 block text-[9px] text-koma-muted">Você busca no restaurante</span>
                  </button>
                </div>

                {deliveryMethod === "delivery" && (
                  <label className="mt-3 block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-koma-muted">
                      <MapPin className="h-3.5 w-3.5 text-emerald-500" /> Endereço de entrega
                    </span>
                    <textarea
                      rows={2}
                      placeholder="Rua, número, complemento e bairro"
                      value={address}
                      onChange={(event) => {
                        setAddress(event.target.value);
                        if (errorMessage) setErrorMessage("");
                      }}
                      className="w-full resize-none rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500"
                      id="input-delivery-address"
                    />
                    <span className="mt-1.5 block text-[9px] text-koma-subtle">Na próxima tela você confere tudo antes de enviar.</span>
                  </label>
                )}
              </section>

              {user ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-[10px] text-koma-muted">
                  <UserRound className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>Pedido em nome de <strong className="text-koma-foreground">{user.name}</strong>.</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl border border-koma-border bg-koma-card p-3 text-[10px] leading-relaxed text-koma-muted">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>Você só precisa confirmar o celular antes da revisão. Sua sacola e o endereço continuam aqui.</span>
                </div>
              )}

              {errorMessage && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] font-semibold text-rose-400" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-koma-border bg-koma-panel p-4 sm:p-5">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-koma-muted">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-koma-muted">
                    <span>Taxa de entrega estimada</span>
                    <span>{formatPrice(deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-koma-border pt-2 text-sm font-black text-koma-foreground">
                  <span>Total estimado</span>
                  <span className="text-base text-emerald-500">{formatPrice(total)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCheckout}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-600 active:scale-[0.99]"
                id="btn-confirm-order"
              >
                {user ? <ShoppingBag className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                <span>{user ? "Revisar pedido" : "Continuar com celular"}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-2 text-center text-[9px] leading-relaxed text-koma-subtle">
                Nada é enviado ao restaurante antes da tela de revisão.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
