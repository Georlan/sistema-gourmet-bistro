"""Exceções canônicas do domínio de Pedidos."""

from __future__ import annotations


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

    def __init__(self, product_id: int, quantity: object) -> None:
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
