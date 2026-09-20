"""Comandos e Value Objects de entrada para a camada de aplicação de Pedidos."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import math
from typing import Optional, Tuple
from ...domain.orders.types import FulfillmentType, OrderChannel
from ...domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidExternalReferenceError,
    InvalidFulfillmentDetailsError,
    InvalidItemQuantityError,
)


def _clean_address_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _validated_coordinate(value: object, *, latitude: bool) -> float:
    label = "Latitude" if latitude else "Longitude"
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        raise InvalidFulfillmentDetailsError(
            f"{label} do endereço de entrega é inválida."
        ) from None
    limit = 90 if latitude else 180
    if not math.isfinite(coordinate) or not -limit <= coordinate <= limit:
        raise InvalidFulfillmentDetailsError(
            f"{label} do endereço de entrega é inválida."
        )
    return coordinate


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

    product_id: str | int
    quantity: Decimal
    modifier_ids: Tuple[str | int, ...] = ()
    notes: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.product_id or (isinstance(self.product_id, int) and self.product_id <= 0):
            raise InvalidItemQuantityError(self.product_id, self.quantity)
        if self.quantity <= Decimal("0"):
            raise InvalidItemQuantityError(self.product_id, self.quantity)


@dataclass(frozen=True)
class CustomerInput:
    """Dados cadastrais ou de contato do cliente do pedido."""

    customer_id: Optional[str | int] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    cpf: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


@dataclass(frozen=True)
class DeliveryAddressInput:
    """Snapshot estruturado e imutável do endereço usado no pedido.

    O cadastro do cliente pode mudar depois; estes valores pertencem ao pedido e
    representam o destino aceito no momento do checkout.
    """

    street: str
    number: str
    neighborhood: str
    city: str
    state: str
    postal_code: str
    complement: Optional[str] = None
    reference: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    def __post_init__(self) -> None:
        street = _clean_address_text(self.street)
        number = _clean_address_text(self.number)
        neighborhood = _clean_address_text(self.neighborhood)
        city = _clean_address_text(self.city)
        state = _clean_address_text(self.state).upper()
        postal_code = "".join(character for character in str(self.postal_code or "") if character.isdigit())
        complement = _clean_address_text(self.complement) or None
        reference = _clean_address_text(self.reference) or None

        if not street:
            raise InvalidFulfillmentDetailsError("Logradouro de entrega é obrigatório.")
        if not number:
            raise InvalidFulfillmentDetailsError("Número do endereço de entrega é obrigatório.")
        if not neighborhood:
            raise InvalidFulfillmentDetailsError("Bairro de entrega é obrigatório.")
        if not city:
            raise InvalidFulfillmentDetailsError("Cidade de entrega é obrigatória.")
        if len(state) != 2 or not state.isalpha():
            raise InvalidFulfillmentDetailsError("UF do endereço de entrega deve conter 2 letras.")
        if postal_code and len(postal_code) != 8:
            raise InvalidFulfillmentDetailsError("CEP do endereço de entrega deve conter 8 dígitos quando informado.")
        if (self.latitude is None) != (self.longitude is None):
            raise InvalidFulfillmentDetailsError("Latitude e longitude devem ser informadas juntas.")
        latitude = (
            _validated_coordinate(self.latitude, latitude=True)
            if self.latitude is not None
            else None
        )
        longitude = (
            _validated_coordinate(self.longitude, latitude=False)
            if self.longitude is not None
            else None
        )
        if latitude == 0 and longitude == 0:
            raise InvalidFulfillmentDetailsError(
                "As coordenadas do endereço de entrega não podem ser 0,0."
            )

        object.__setattr__(self, "street", street)
        object.__setattr__(self, "number", number)
        object.__setattr__(self, "neighborhood", neighborhood)
        object.__setattr__(self, "city", city)
        object.__setattr__(self, "state", state)
        object.__setattr__(self, "postal_code", postal_code)
        object.__setattr__(self, "complement", complement)
        object.__setattr__(self, "reference", reference)
        object.__setattr__(self, "latitude", latitude)
        object.__setattr__(self, "longitude", longitude)

    def to_snapshot(self) -> dict[str, object]:
        """Contrato persistido; nomes em PT-BR para coincidir com a API pública."""
        return {
            "logradouro": self.street,
            "numero": self.number,
            "complemento": self.complement,
            "bairro": self.neighborhood,
            "cidade": self.city,
            "uf": self.state,
            "cep": self.postal_code,
            "referencia": self.reference,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }

    def to_legacy_address(self) -> str:
        """Representação legada para consumidores que ainda leem delivery_endereco."""
        parts = [f"{self.street}, {self.number}"]
        if self.complement:
            parts.append(self.complement)
        parts.append(self.neighborhood)
        parts.append(f"{self.city} - {self.state}")
        if self.postal_code:
            formatted_cep = f"{self.postal_code[:5]}-{self.postal_code[5:]}"
            parts.append(f"CEP {formatted_cep}")
        if self.reference:
            parts.append(f"Ref.: {self.reference}")
        return ", ".join(parts)


@dataclass(frozen=True)
class DeliveryInput:
    """Dados logísticos específicos para modalidade Delivery."""

    address: Optional[str] = None
    neighborhood: Optional[str] = None
    fee: Optional[Decimal] = None
    estimated_minutes: Optional[int] = None
    notes: Optional[str] = None
    address_snapshot: Optional[DeliveryAddressInput] = None

    def __post_init__(self) -> None:
        has_legacy_address = bool(self.address and str(self.address).strip())
        if not has_legacy_address and self.address_snapshot is None:
            raise InvalidFulfillmentDetailsError(
                "O endereço de entrega é obrigatório para pedidos na modalidade Delivery."
            )
        if self.fee is not None and self.fee < Decimal("0.00"):
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
    table_id: Optional[str | int] = None
    check_id: Optional[str | int] = None
    atendimento_id: Optional[str | int] = None
    coupon_code: Optional[str] = None
    cashback_discount: Decimal = Decimal("0.00")
    usar_cashback: bool = False
    payment_method: Optional[str] = None
    change_for: Optional[str] = None
    idempotency_key: Optional[str] = None
    idempotency_fingerprint: Optional[str] = None
    idempotency_fingerprint_version: Optional[int] = None
    external_reference: Optional[ExternalOrderReference] = None
    operator_user_id: Optional[str | int] = None
    onboarding_test: bool = False
    # Pedidos com pagamento online existem antes da autorização, mas ainda não
    # podem ser publicados para cozinha/caixa. O webhook publica após aprovar.
    defer_operational_publish: bool = False

    def __post_init__(self) -> None:
        if self.restaurant_id <= 0:
            raise InvalidFulfillmentDetailsError("restaurant_id deve ser maior que zero.")
        if not self.items:
            raise EmptyOrderItemsError()
        if self.fulfillment == FulfillmentType.DELIVERY and self.delivery is None:
            raise InvalidFulfillmentDetailsError(
                "Pedidos com modalidade DELIVERY exigem informações de entrega (DeliveryInput)."
            )
        if self.fulfillment == FulfillmentType.DELIVERY and self.table_id is not None:
            raise InvalidFulfillmentDetailsError(
                "Pedidos de delivery não podem ser vinculados a uma mesa."
            )


@dataclass(frozen=True)
class AcceptOrderCommand:
    """Comando para aceitar um pedido pendente para preparo."""

    restaurant_id: int
    order_id: str | int
    operator_user_id: Optional[str | int] = None
    estimated_prep_minutes: Optional[int] = None


@dataclass(frozen=True)
class MarkOrderReadyCommand:
    """Comando para sinalizar que o pedido está pronto na cozinha/bar."""

    restaurant_id: int
    order_id: str | int
    operator_user_id: Optional[str | int] = None


@dataclass(frozen=True)
class DispatchOrderCommand:
    """Comando para despachar pedido de delivery para entrega com motoboy."""

    restaurant_id: int
    order_id: str | int
    courier_id: Optional[str | int] = None
    operator_user_id: Optional[str | int] = None


@dataclass(frozen=True)
class CompleteOrderCommand:
    """Comando para finalizar e entregar o pedido."""

    restaurant_id: int
    order_id: str | int
    operator_user_id: Optional[str | int] = None


@dataclass(frozen=True)
class RejectOrderCommand:
    """Comando para rejeitar um pedido antes de entrar em produção."""

    restaurant_id: int
    order_id: str | int
    reason: str
    operator_user_id: Optional[str | int] = None


@dataclass(frozen=True)
class CancelOrderCommand:
    """Comando para cancelar um pedido em andamento com auditoria."""

    restaurant_id: int
    order_id: str | int
    reason: str
    operator_user_id: Optional[str | int] = None
    refund_stock: bool = True