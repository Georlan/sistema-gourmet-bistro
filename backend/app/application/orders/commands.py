"""Comandos e Value Objects de entrada para a camada de aplicação de Pedidos."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, Tuple
from ...domain.orders.types import FulfillmentType, OrderChannel
from ...domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidExternalReferenceError,
    InvalidFulfillmentDetailsError,
    InvalidItemQuantityError,
)


@dataclass(frozen=True)
class ExternalOrderReference:
    """Identificador de integração com canais terceiros (iFood, 99Food, Keeta, etc.)."""

    provider: str
    external_order_id: str

    def __post_init__(self) -> None:
        if not self.provider or not str(self.provider).strip():
            raise InvalidExternalReferenceError("O 'provider' da referência externa não pode ser vazio.")
        if not self.external_order_id or not str(self.external_order_id).strip():
            raise InvalidExternalReferenceError("O 'external_order_id' da referência externa não pode ser vazio.")


@dataclass(frozen=True)
class OrderItemInput:
    """Item a ser lançado ou criado em um pedido."""

    product_id: int
    quantity: Decimal
    modifier_ids: Tuple[int, ...] = ()
    notes: Optional[str] = None

    def __post_init__(self) -> None:
        if self.product_id <= 0:
            raise InvalidItemQuantityError(self.product_id, self.quantity)
        if self.quantity <= Decimal("0"):
            raise InvalidItemQuantityError(self.product_id, self.quantity)


@dataclass(frozen=True)
class CustomerInput:
    """Dados cadastrais ou de contato do cliente do pedido."""

    customer_id: Optional[int] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    cpf: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


@dataclass(frozen=True)
class DeliveryInput:
    """Dados logísticos específicos para modalidade Delivery."""

    address: str
    fee: Decimal = Decimal("0.00")
    estimated_minutes: Optional[int] = None
    notes: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.address or not str(self.address).strip():
            raise InvalidFulfillmentDetailsError(
                "O endereço de entrega é obrigatório para pedidos na modalidade Delivery."
            )
        if self.fee < Decimal("0.00"):
            raise InvalidFulfillmentDetailsError("A taxa de entrega não pode ser negativa.")


@dataclass(frozen=True)
class CreateOrderCommand:
    """Comando canônico de criação de pedido a partir de qualquer canal."""

    restaurant_id: int
    channel: OrderChannel
    fulfillment: FulfillmentType
    items: Tuple[OrderItemInput, ...]
    customer: Optional[CustomerInput] = None
    delivery: Optional[DeliveryInput] = None
    table_id: Optional[int] = None
    check_id: Optional[int] = None
    atendimento_id: Optional[int] = None
    coupon_code: Optional[str] = None
    cashback_discount: Decimal = Decimal("0.00")
    idempotency_key: Optional[str] = None
    external_reference: Optional[ExternalOrderReference] = None
    operator_user_id: Optional[int] = None

    def __post_init__(self) -> None:
        if self.restaurant_id <= 0:
            raise InvalidFulfillmentDetailsError("restaurant_id deve ser maior que zero.")
        if not self.items:
            raise EmptyOrderItemsError()
        if self.fulfillment == FulfillmentType.DELIVERY and self.delivery is None:
            raise InvalidFulfillmentDetailsError(
                "Pedidos com modalidade DELIVERY exigem informações de entrega (DeliveryInput)."
            )


@dataclass(frozen=True)
class AcceptOrderCommand:
    """Comando para aceitar um pedido pendente para preparo."""

    restaurant_id: int
    order_id: int
    operator_user_id: Optional[int] = None
    estimated_prep_minutes: Optional[int] = None


@dataclass(frozen=True)
class MarkOrderReadyCommand:
    """Comando para sinalizar que o pedido está pronto na cozinha/bar."""

    restaurant_id: int
    order_id: int
    operator_user_id: Optional[int] = None


@dataclass(frozen=True)
class DispatchOrderCommand:
    """Comando para despachar pedido de delivery para entrega com motoboy."""

    restaurant_id: int
    order_id: int
    courier_id: Optional[int] = None
    operator_user_id: Optional[int] = None


@dataclass(frozen=True)
class CompleteOrderCommand:
    """Comando para finalizar e entregar o pedido."""

    restaurant_id: int
    order_id: int
    operator_user_id: Optional[int] = None


@dataclass(frozen=True)
class RejectOrderCommand:
    """Comando para rejeitar um pedido antes de entrar em produção."""

    restaurant_id: int
    order_id: int
    reason: str
    operator_user_id: Optional[int] = None


@dataclass(frozen=True)
class CancelOrderCommand:
    """Comando para cancelar um pedido em andamento com auditoria."""

    restaurant_id: int
    order_id: int
    reason: str
    operator_user_id: Optional[int] = None
    refund_stock: bool = True
