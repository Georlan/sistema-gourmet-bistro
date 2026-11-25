import React from "react";
import { RefreshCw } from "lucide-react";
import { DeliveryReceiptCode } from "../components/DeliveryReceiptCode";
import {
  orderProgress,
  resolveOrderState,
  type OrderStateContract,
  type StoredOrder,
} from "../orderTracking";
import "./menuActiveOrder.css";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface MenuActiveOrderCardProps {
  id?: string;
  activeOrder: StoredOrder;
  activeState: OrderStateContract;
  statusLabel: string;
  fulfillmentLabel: string;
  storedOrders?: StoredOrder[];
  isRefreshingOrders?: boolean;
  onSelectOrderId?: (id: string) => void;
  onPayPixClick?: (order: StoredOrder) => void;
  onRefreshOrders?: () => void;
  onDismissTrackedOrder?: (orderId: string) => void;
  onOrdersClick?: () => void;
}

function getOrderNextStepHint(
  state: OrderStateContract,
  order: StoredOrder,
): string | null {
  switch (state.phase) {
    case "payment_pending":
      return "Primeiro: confirme o Pix";
    case "payment_failed":
      return "Pagamento não concluído · tente novamente";
    case "scheduled":
      return "Pedido agendado · aguardando horário";
    case "received":
      return "Aguardando aceite · próximo: confirmação da loja";
    case "accepted":
      return "Aceito pela loja · próximo: preparo";
    case "preparing":
      return "Em preparo na loja · próximo: ficar pronto";
    case "ready":
      if (state.fulfillment === "delivery") {
        return "Pronto para sair · próximo: saída para entrega";
      }
      if (state.fulfillment === "pickup") {
        return "Pronto · disponível para retirada no balcão";
      }
      return "Pronto · próximo: entrega na mesa";
    case "dispatched":
      return "Saiu para entrega · próximo: entrega concluída";
    case "completed":
      return null;
    case "rejected":
      return "Não aceito pelo restaurante";
    case "cancelled":
      return "Este pedido foi cancelado";
    default:
      return order.pagamento?.cliente_informou_pagamento
        ? "Pagamento informado · aguardando confirmação"
        : null;
  }
}

export function MenuActiveOrderCard({
  id = "active-order-banner",
  activeOrder,
  activeState,
  statusLabel,
  fulfillmentLabel,
  storedOrders = [],
  isRefreshingOrders = false,
  onSelectOrderId,
  onPayPixClick,
  onRefreshOrders,
  onDismissTrackedOrder,
  onOrdersClick,
}: MenuActiveOrderCardProps) {
  if (!activeOrder || !activeState) return null;

  const progress = orderProgress(activeState);
  const nextStepHint = getOrderNextStepHint(activeState, activeOrder);
  const isAlertState =
    activeState.rejected || activeState.phase === "payment_failed";
  const isPaymentPending = activeState.phase === "payment_pending";
  const totalValue = Number(activeOrder.total || 0);

  return (
    <section
      id={id}
      className={`km-order-card${isAlertState ? " km-order-card--alert" : ""}`}
      aria-label={activeState.terminal ? "Resultado do pedido" : "Pedido em andamento"}
      data-order-id={activeOrder.id}
      data-order-phase={activeState.phase}
    >
      {storedOrders.length > 1 && onSelectOrderId && (
        <div
          className="km-order-card__switcher"
          role="group"
          aria-label="Alternar pedido acompanhado"
        >
          {storedOrders.map((ord) => {
            const selected = ord.id === activeOrder.id;
            const ordActive = !resolveOrderState(ord).terminal;
            return (
              <button
                key={ord.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectOrderId(ord.id)}
                className={`km-order-card__switch-btn${selected ? " is-selected" : ""}`}
              >
                <span>#{ord.numero_pedido}</span>
                {ordActive && (
                  <span
                    className={`km-order-card__switch-dot${selected ? " is-selected" : ""}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="km-order-card__head">
        <div className="km-order-card__summary">
          <div className="km-order-card__eyebrow">
            {activeOrder.numero_pedido
              ? `Pedido #${activeOrder.numero_pedido}`
              : "Acompanhamento"}
          </div>
          <h2 className="km-order-card__title km-tabular">{statusLabel}</h2>
          <div className="km-order-card__meta km-tabular">
            {fulfillmentLabel}
            {Number.isFinite(totalValue) && totalValue > 0 ? ` · Total: ${brlFormatter.format(totalValue)}` : ""}
          </div>
        </div>

        <div className="km-order-card__actions">
          {isPaymentPending && activeOrder.pagamento?.qr_code && onPayPixClick ? (
            <button
              type="button"
              className="km-order-card__cta"
              onClick={() => onPayPixClick(activeOrder)}
            >
              Pagar Pix
            </button>
          ) : null}

          {!activeState.terminal && onRefreshOrders && (
            <button
              type="button"
              disabled={isRefreshingOrders}
              onClick={onRefreshOrders}
              aria-label="Atualizar status do pedido"
              className="km-order-card__refresh"
            >
              <RefreshCw
                size={13}
                className={isRefreshingOrders ? "km-order-card__spin" : undefined}
                aria-hidden="true"
              />
              <span>Atualizar</span>
            </button>
          )}

          {activeState.terminal && onDismissTrackedOrder ? (
            <button
              type="button"
              className="km-order-card__cta"
              onClick={() => onDismissTrackedOrder(activeOrder.id)}
            >
              Entendi
            </button>
          ) : (
            onOrdersClick && (
              <button
                type="button"
                className="km-order-card__cta"
                onClick={onOrdersClick}
              >
                Acompanhar pedido
              </button>
            )
          )}
        </div>
      </div>

      {progress && (
        <div
          key={`progress-${activeOrder.id}`}
          className="km-order-card__progress"
          data-progress-current={progress.current}
          data-progress-total={progress.labels.length}
        >
          <ol
            className="km-order-card__track"
            style={{
              gridTemplateColumns: `repeat(${progress.labels.length}, minmax(0, 1fr))`,
            }}
            aria-label="Etapas confirmadas do pedido"
          >
            {progress.labels.map((label, index) => {
              const stepNumber = index + 1;
              const isDone = activeState.phase === "completed"
                ? stepNumber <= progress.current
                : stepNumber < progress.current;
              const isActive = !activeState.terminal && stepNumber === progress.current;
              const stepState = isDone ? "done" : isActive ? "active" : "upcoming";

              return (
                <li
                  key={label}
                  className={`km-order-card__step km-order-card__step--${stepState}`}
                  data-step-index={stepNumber}
                  data-step-state={stepState}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="km-order-card__step-bar" aria-hidden="true" />
                  <span className="km-order-card__step-label">{label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {nextStepHint && (
        <p
          className={`km-order-card__hint${
            isAlertState || isPaymentPending ? " km-order-card__hint--alert" : ""
          }`}
        >
          {nextStepHint}
        </p>
      )}

      {!activeState.terminal && activeOrder.delivery_receipt_code ? (
        <div key={`receipt-${activeOrder.id}`} className="km-order-card__receipt">
          <DeliveryReceiptCode compact code={activeOrder.delivery_receipt_code} />
        </div>
      ) : null}
    </section>
  );
}

export default MenuActiveOrderCard;
