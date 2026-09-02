"""Coordenação canônica do ciclo de vida de pedidos na borda legada.

Este módulo não define uma segunda máquina de estados. Ele traduz o contrato
HTTP legado de ``delivery_status`` para os comandos já pertencentes ao
``OrderApplicationService`` e deixa a validação de transição com
``OrderStateMachine``.

A intenção é manter rotas, KDS e telas de entrega como consumidores do Core, e
não como writers independentes de ``Comanda.delivery_status``/``Lancamento.status``.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ...domain.orders.errors import OrderValidationError
from ...domain.orders.state_machine import OrderStateMachine
from ...domain.orders.types import (
    FulfillmentType,
    OrderStatus,
    normalize_to_fulfillment,
    normalize_to_order_status,
    to_legacy_order_status,
)
from ...models import Comanda
from .commands import (
    AcceptOrderCommand,
    CancelOrderCommand,
    CompleteOrderCommand,
    DispatchOrderCommand,
    MarkOrderReadyCommand,
    RejectOrderCommand,
)
from .service import OrderApplicationService


LEGACY_ORDER_STATUS_INPUTS = frozenset(
    to_legacy_order_status(status) for status in OrderStatus
)

_TERMINAL_ORDER_STATUSES = {
    OrderStatus.COMPLETED,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
}


@dataclass(frozen=True)
class OrderLifecycleResult:
    """Resultado agregado de uma transição no nível da Comanda."""

    comanda: Comanda
    current_status: OrderStatus
    target_status: OrderStatus
    changed: bool
    first_accept: bool


class OrderLifecycleCoordinator:
    """Adapta transições da Comanda para comandos canônicos por pedido/lote."""

    @classmethod
    def transition_check_status(
        cls,
        db: Session,
        *,
        restaurant_id: int,
        comanda_id: str,
        target_status: str | OrderStatus,
        operator_user_id: str | int | None = None,
        courier_id: str | int | None = None,
        reason: str | None = None,
        commit: bool = True,
    ) -> OrderLifecycleResult:
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == restaurant_id,
                Comanda.id == str(comanda_id),
            )
            .with_for_update()
            .first()
        )
        if comanda is None:
            raise OrderValidationError(f"Pedido/Comanda {comanda_id} não encontrado.")

        current = normalize_to_order_status(comanda.delivery_status)
        target = normalize_to_order_status(target_status)
        fulfillment = normalize_to_fulfillment(comanda.tipo)
        transition = OrderStateMachine.validate_transition(
            current_status=current,
            target_status=target,
            fulfillment=fulfillment,
        )

        result = OrderLifecycleResult(
            comanda=comanda,
            current_status=current,
            target_status=target,
            changed=transition.changed,
            first_accept=transition.first_accept,
        )
        if not transition.changed:
            return result

        if (
            target == OrderStatus.DISPATCHED
            and fulfillment == FulfillmentType.DELIVERY
            and courier_id is None
        ):
            raise OrderValidationError(
                "Pedido de delivery precisa de motoboy antes da transição para trânsito."
            )

        active_orders = cls._active_orders(comanda)
        if not active_orders:
            if comanda.lancamentos:
                raise OrderValidationError(
                    "A Comanda possui apenas pedidos terminais e não pode avançar de status."
                )
            # Compatibilidade com comandas legadas sem Lancamento persistido.
            active_orders = [(comanda.id, current)]

        # Uma Comanda pode conter mais de um Lancamento e o KDS pode deixá-los em
        # estágios diferentes. Validar cada lançamento evita dois problemas do
        # antigo writer agregado: saltos silenciosos e eventos duplicados para um
        # lançamento que já atingiu o estado solicitado.
        pending_transitions = cls._pending_order_transitions(
            active_orders,
            target_status=target,
            fulfillment=fulfillment,
        )

        for order_id, order_current in pending_transitions:
            cls._apply_single_transition(
                db,
                restaurant_id=restaurant_id,
                order_id=order_id,
                current_status=order_current,
                target_status=target,
                operator_user_id=operator_user_id,
                courier_id=courier_id,
                reason=reason,
            )

        # ``complete_order`` finaliza o pedido/lote; a Comanda é a agregação
        # operacional usada pelo contrato legado. Fechar a conta aqui mantém a
        # regra fora da rota e cobre também comandas antigas sem Lancamento.
        if target == OrderStatus.COMPLETED:
            comanda.delivery_status = to_legacy_order_status(OrderStatus.COMPLETED)
            comanda.fechada = True
            if comanda.fechado_em is None:
                comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)

        if commit:
            db.commit()
            db.refresh(comanda)

        return OrderLifecycleResult(
            comanda=comanda,
            current_status=current,
            target_status=target,
            changed=True,
            first_accept=transition.first_accept,
        )

    @staticmethod
    def _active_orders(comanda: Comanda) -> list[tuple[str, OrderStatus]]:
        """Retorna lançamentos não terminais preservando o status individual."""

        launches = sorted(
            list(comanda.lancamentos or []),
            key=lambda launch: (str(launch.timestamp or ""), str(launch.id)),
        )
        active: list[tuple[str, OrderStatus]] = []
        for launch in launches:
            launch_status = normalize_to_order_status(launch.status)
            if launch_status in _TERMINAL_ORDER_STATUSES:
                continue
            active.append((str(launch.id), launch_status))
        return active

    @staticmethod
    def _pending_order_transitions(
        active_orders: list[tuple[str, OrderStatus]],
        *,
        target_status: OrderStatus,
        fulfillment: FulfillmentType,
    ) -> list[tuple[str, OrderStatus]]:
        """Valida cada lançamento e elimina apenas transições já aplicadas.

        Os serviços de aplicação emitem eventos de domínio quando chamados; por
        isso não devemos chamá-los novamente para um lançamento que já está no
        alvo. Ao mesmo tempo, qualquer lançamento atrasado que não possa alcançar
        o alvo faz a transação falhar antes de qualquer escrita parcial.
        """

        pending: list[tuple[str, OrderStatus]] = []
        for order_id, current_status in active_orders:
            transition = OrderStateMachine.validate_transition(
                current_status=current_status,
                target_status=target_status,
                fulfillment=fulfillment,
            )
            if transition.changed:
                pending.append((order_id, current_status))
        return pending

    @staticmethod
    def _apply_single_transition(
        db: Session,
        *,
        restaurant_id: int,
        order_id: str,
        current_status: OrderStatus,
        target_status: OrderStatus,
        operator_user_id: str | int | None,
        courier_id: str | int | None,
        reason: str | None,
    ) -> None:
        common = {
            "restaurant_id": restaurant_id,
            "order_id": order_id,
            "operator_user_id": operator_user_id,
        }

        if target_status == OrderStatus.PREPARING:
            OrderApplicationService.accept_order(
                db,
                AcceptOrderCommand(**common),
                commit=False,
            )
            return

        if target_status == OrderStatus.READY:
            OrderApplicationService.mark_order_ready(
                db,
                MarkOrderReadyCommand(**common),
                commit=False,
            )
            return

        if target_status == OrderStatus.DISPATCHED:
            OrderApplicationService.dispatch_order(
                db,
                DispatchOrderCommand(
                    **common,
                    courier_id=courier_id,
                ),
                commit=False,
            )
            return

        if target_status == OrderStatus.COMPLETED:
            OrderApplicationService.complete_order(
                db,
                CompleteOrderCommand(**common),
                commit=False,
            )
            return

        if target_status in {OrderStatus.REJECTED, OrderStatus.CANCELLED}:
            if current_status == OrderStatus.PENDING:
                OrderApplicationService.reject_order(
                    db,
                    RejectOrderCommand(
                        **common,
                        reason=reason or "Recusado pelo restaurante",
                    ),
                    commit=False,
                )
            else:
                OrderApplicationService.cancel_order(
                    db,
                    CancelOrderCommand(
                        **common,
                        reason=reason or "Cancelado pela operação",
                        refund_stock=True,
                    ),
                    commit=False,
                )
            return

        raise OrderValidationError(
            f"A transição para {target_status.value} não possui comando de aplicação."
        )