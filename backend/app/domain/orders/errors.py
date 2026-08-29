"""Exceções canônicas do domínio de Pedidos."""

from __future__ import annotations
from decimal import Decimal


class OrderDomainError(Exception):
    """Exceção base para violações de invariantes do domínio de pedidos."""


class InvalidOrderStateError(OrderDomainError):
    """Estado do pedido inválido ou não suportado."""


class InvalidOrderTransitionError(OrderDomainError):
    """Tentativa de transição de status proibida pela máquina de estados."""

    def __init__(
        self,
        current_status: str,
        target_status: str,
        allowed_targets: tuple[str, ...],
    ) -> None:
        self.current_status = current_status
        self.target_status = target_status
        self.allowed_targets = allowed_targets
        allowed_str = ", ".join(allowed_targets) if allowed_targets else "nenhum"
        super().__init__(
            f"Transição de pedido inválida: {current_status} → {target_status}. "
            f"Próximos status permitidos: {allowed_str}."
        )


class OrderValidationError(OrderDomainError):
    """Falha de validação de dados de entrada do pedido."""


class EmptyOrderItemsError(OrderValidationError):
    """Pedido não pode ser criado sem ao menos um item válido."""

    def __init__(self) -> None:
        super().__init__("O pedido deve conter pelo menos um item.")


class InvalidItemQuantityError(OrderValidationError):
    """Quantidade do item deve ser estritamente positiva."""

    def __init__(self, product_id: str | int, quantity: object) -> None:
        self.product_id = product_id
        self.quantity = quantity
        super().__init__(
            f"Quantidade inválida para o produto id={product_id}: {quantity}. "
            f"A quantidade deve ser maior que zero."
        )


class InvalidFulfillmentDetailsError(OrderValidationError):
    """Dados de atendimento ou entrega inconsistentes com a modalidade."""


class InvalidExternalReferenceError(OrderValidationError):
    """Referência externa inválida ou incompleta (exige provider e external_order_id)."""


class ProductNotFoundError(OrderValidationError):
    """Produto não encontrado no catálogo."""

    def __init__(self, product_id: str | int) -> None:
        self.product_id = product_id
        super().__init__(f"Produto '{product_id}' não encontrado para este estabelecimento.")


class ProductInactiveError(OrderValidationError):
    """Produto está desativado no cardápio."""

    def __init__(self, product_id: str | int) -> None:
        self.product_id = product_id
        super().__init__(f"Produto '{product_id}' está inativo no momento.")


class ProductTenantMismatchError(OrderValidationError):
    """Produto pertence a outro estabelecimento comercial (violação multi-tenant)."""

    def __init__(self, product_id: str | int, expected_tenant: int, actual_tenant: int) -> None:
        self.product_id = product_id
        self.expected_tenant = expected_tenant
        self.actual_tenant = actual_tenant
        super().__init__(
            f"Produto '{product_id}' pertence ao restaurante id={actual_tenant}, "
            f"não ao restaurante id={expected_tenant}."
        )


class ModifierNotFoundError(OrderValidationError):
    """Modificador ou adicional não encontrado no catálogo."""

    def __init__(self, modifier_id: str | int) -> None:
        self.modifier_id = modifier_id
        super().__init__(f"Modificador '{modifier_id}' não encontrado.")


class ModifierInactiveError(OrderValidationError):
    """Modificador ou adicional está inativo."""

    def __init__(self, modifier_id: str | int) -> None:
        self.modifier_id = modifier_id
        super().__init__(f"Modificador '{modifier_id}' está inativo no momento.")


class ModifierGroupMismatchError(OrderValidationError):
    """Modificador selecionado não pertence aos grupos permitidos para o produto."""

    def __init__(self, modifier_id: str | int, product_id: str | int) -> None:
        self.modifier_id = modifier_id
        self.product_id = product_id
        super().__init__(
            f"Modificador '{modifier_id}' não é uma opção válida para o produto '{product_id}'."
        )


class MinimumOrderAmountNotMetError(OrderValidationError):
    """Subtotal do pedido de entrega não atinge o valor mínimo exigido pelo restaurante."""

    def __init__(self, subtotal: Decimal, minimum_amount: Decimal) -> None:
        self.subtotal = subtotal
        self.minimum_amount = minimum_amount
        super().__init__(
            f"O valor mínimo para entrega é de R$ {minimum_amount:.2f} (subtotal atual: R$ {subtotal:.2f})."
        )
