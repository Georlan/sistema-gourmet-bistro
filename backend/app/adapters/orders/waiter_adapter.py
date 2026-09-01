"""Adaptador de Borda para Lançamentos de Pedidos por Garçom / Mesa (Fase 5B).

Fronteira canônica: adiciona um novo pedido/lote a uma comanda/atendimento existente
via OrderApplicationService.create_order(channel=OrderChannel.WAITER).
"""

from __future__ import annotations

import datetime
import logging
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ...application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    OrderItemInput,
)
from ...application.orders.service import OrderApplicationService
from ...application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintTrigger,
    PrintingApplicationService,
    UniversalPrintingError,
)
from ...database import require_tenant_id
from ...domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidItemQuantityError,
    ModifierGroupMismatchError,
    ModifierInactiveError,
    ModifierNotFoundError,
    ProductInactiveError,
    ProductNotFoundError,
    ProductTenantMismatchError,
)
from ...domain.orders.types import FulfillmentType, OrderChannel
from ...models import (
    Comanda,
    Item,
    Lancamento,
    Usuario,
)
from ...schemas import LancamentoCreate, LancamentoResponse
from ...services.atendimentos import (
    ensure_atendimento_for_comanda,
    ensure_launch_identity,
)
from ...services.order_numbers import gerar_novo_numero_pedido_atomico
from ...services.shifts import require_open_cash_shift
from ...waiter_permissions import (
    require_waiter_permission,
    waiter_permission_enabled,
)
from ...websocket_manager import manager


logger = logging.getLogger("koma.adapters.waiter")


class WaiterAdapter:
    """Adaptador de borda para o canal Garçom / Lançamentos em Comanda Existente."""

    @classmethod
    async def handle_launch_items(
        cls,
        *,
        comanda_id: str,
        lancamento_in: LancamentoCreate,
        background_tasks: BackgroundTasks,
        db: Session,
        current_user: Usuario,
    ) -> LancamentoResponse:
        """Processa o lançamento de itens em comanda existente delegando ao Core."""
        rid = require_tenant_id()
        normalized_idempotency_key = (
            lancamento_in.idempotency_key.strip()
            if lancamento_in.idempotency_key
            else None
        )

        # 1. Validação de comanda existente e ativa
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == rid,
                Comanda.id == comanda_id,
            )
            .first()
        )
        if not comanda:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Comanda não encontrada",
            )

        if comanda.fechada:
            if comanda.mesa_id:
                # Comanda de mesa fechada: abre uma nova comanda para a mesma mesa
                nova_comanda = Comanda(
                    id=f"c-{uuid.uuid4().hex[:8]}",
                    restaurante_id=rid,
                    mesa_id=comanda.mesa_id,
                    garcom_id=lancamento_in.garcom_id or current_user.id,
                    tipo="Consumo no Local",
                    numero_pedido=gerar_novo_numero_pedido_atomico(db, restaurante_id=rid),
                    fechada=False,
                    criado_em=datetime.datetime.now(datetime.timezone.utc),
                )
                db.add(nova_comanda)
                db.flush()
                comanda = nova_comanda
                comanda_id = nova_comanda.id
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Comanda já fechada. Reabra antes de lançar novos itens.",
                )

        # 2. Replay rápido de idempotência
        def _ensure_launch_replay_matches(existing_launch: Lancamento) -> Lancamento:
            existing_items = sorted(
                (
                    item.produto_id,
                    (item.observacao or "").strip(),
                )
                for item in existing_launch.itens
                if item.status != "cancelado"
            )
            requested_items = sorted(
                (
                    item.produto_id,
                    (item.observacao or "").strip(),
                )
                for item in lancamento_in.itens
            )
            if (
                existing_launch.comanda_id != comanda_id
                or existing_launch.garcom_id != lancamento_in.garcom_id
                or existing_items != requested_items
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A chave idempotente já foi usada em outro lançamento.",
                )
            return existing_launch

        if normalized_idempotency_key:
            existing_launch = (
                db.query(Lancamento)
                .options(joinedload(Lancamento.itens))
                .filter(
                    Lancamento.restaurante_id == rid,
                    Lancamento.idempotency_key == normalized_idempotency_key,
                )
                .first()
            )
            if existing_launch is not None:
                return _ensure_launch_replay_matches(existing_launch)

        # 3. Políticas de permissões e caixa
        has_existing_items = (
            db.query(Item.id)
            .filter(
                Item.restaurante_id == rid,
                Item.comanda_id == comanda.id,
                Item.status != "cancelado",
            )
            .first()
            is not None
        )
        if has_existing_items:
            require_waiter_permission(
                db,
                current_user,
                "perm_garcom_editar",
            )

        require_open_cash_shift(db, rid)

        # 4. Resolução de operador / garçom
        garcom_id = lancamento_in.garcom_id or current_user.id
        garcom = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == rid,
                Usuario.id == garcom_id,
            )
            .first()
        )
        if not garcom:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Garçom '{lancamento_in.garcom_id}' não encontrado",
            )

        # 5. Mapeamento para CreateOrderCommand
        if comanda.tipo == "Entrega":
            fulfillment = FulfillmentType.DELIVERY
        elif comanda.tipo == "Retirada":
            fulfillment = FulfillmentType.PICKUP
        else:
            fulfillment = FulfillmentType.DINE_IN

        items_input = tuple(
            OrderItemInput(
                product_id=item.produto_id,
                quantity=Decimal("1"),
                modifier_ids=(),
                notes=item.observacao or "",
            )
            for item in lancamento_in.itens
        )

        customer_name = (
            lancamento_in.itens[0].cliente_nome
            if lancamento_in.itens and lancamento_in.itens[0].cliente_nome
            else comanda.identificador
        )

        cmd = CreateOrderCommand(
            restaurant_id=rid,
            channel=OrderChannel.WAITER,
            fulfillment=fulfillment,
            items=items_input,
            customer=CustomerInput(name=customer_name) if customer_name else None,
            check_id=comanda.id,
            table_id=str(comanda.mesa_id) if comanda.mesa_id is not None else None,
            idempotency_key=normalized_idempotency_key,
            operator_user_id=garcom_id,
        )

        # 6. Criação via Core Universal de Pedidos
        try:
            order_dto = OrderApplicationService.create_order(db, cmd, commit=False)

            # Recarrega lançamento persistido
            novo_lancamento = (
                db.query(Lancamento)
                .options(joinedload(Lancamento.itens).joinedload(Item.produto))
                .filter(
                    Lancamento.restaurante_id == rid,
                    Lancamento.id == order_dto.order_id,
                )
                .first()
            )
            if not novo_lancamento:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Erro ao recuperar lançamento criado.",
                )

            # Identificador operacional canônico para consumo no local
            if comanda.tipo == "Consumo no Local" and comanda.mesa_id is not None:
                ensure_atendimento_for_comanda(db, comanda, actor_id=current_user.id)
                ensure_launch_identity(db, novo_lancamento)

            # 7. Impressão: a borda declara somente intenção. O Core resolve
            # motor (local/retirada/delivery), política, documento e PrintJob.
            novo_lancamento.dispensado_impressao = True
            if waiter_permission_enabled(
                db,
                current_user,
                "perm_garcom_print",
            ):
                try:
                    jobs = PrintingApplicationService.request_print(
                        db,
                        PrintIntent(
                            restaurant_id=rid,
                            source_type=PrintSourceType.ORDER,
                            source_id=novo_lancamento.id,
                            action=PrintAction.PRINT,
                            trigger=PrintTrigger.AUTOMATIC,
                            table_id=comanda.mesa_id,
                            requested_by=garcom.nome,
                            idempotency_key=f"universal:auto:lancamento:{novo_lancamento.id}",
                        ),
                    )
                    novo_lancamento.dispensado_impressao = not bool(jobs)
                except UniversalPrintingError as print_err:
                    novo_lancamento.dispensado_impressao = True
                    logger.warning(
                        "Falha no Core Universal de Impressão do lançamento %s: %s",
                        novo_lancamento.id,
                        print_err,
                    )

            # Pedido e PrintJob são persistidos na mesma transação.
            db.commit()
            db.refresh(novo_lancamento)

        except HTTPException:
            db.rollback()
            raise
        except (ProductNotFoundError, ProductInactiveError, ProductTenantMismatchError):
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Um produto do pedido não está mais disponível.",
            )
        except (ModifierNotFoundError, ModifierInactiveError, ModifierGroupMismatchError):
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Modificador não encontrado ou inativo.",
            )
        except EmptyOrderItemsError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="O pedido deve conter pelo menos um item.",
            )
        except InvalidItemQuantityError as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(err),
            )
        except IntegrityError:
            db.rollback()
            if normalized_idempotency_key:
                concurrent_launch = (
                    db.query(Lancamento)
                    .options(joinedload(Lancamento.itens))
                    .filter(
                        Lancamento.restaurante_id == rid,
                        Lancamento.idempotency_key == normalized_idempotency_key,
                    )
                    .first()
                )
                if concurrent_launch is not None:
                    return _ensure_launch_replay_matches(concurrent_launch)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Conflito de integridade ao processar o lançamento.",
            )
        except Exception as exc:
            db.rollback()
            logger.exception("Falha inesperada ao processar lançamento do garçom: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Erro ao processar lançamento do pedido.",
            )

        # 8. Broadcasts de WebSocket
        if comanda.mesa_id is not None:
            await manager.broadcast(
                {
                    "type": "MESA_UPDATED",
                    "mesa_id": comanda.mesa_id,
                    "status": "OCUPADA",
                },
                tenant_id=current_user.tenant_id,
            )

        background_tasks.add_task(
            manager.broadcast,
            {
                "type": "LANCAMENTO_CRIADO",
                "comanda_id": comanda.id,
                "lancamento_id": novo_lancamento.id,
                "itens": [
                    {
                        "id": it.id,
                        "produto_nome": it.produto.nome if it.produto else "",
                        "quantidade": 1,
                        "observacao": it.observacao,
                        "preco_unit": it.preco_unit,
                    }
                    for it in novo_lancamento.itens
                ],
            },
            tenant_id=current_user.tenant_id,
        )

        background_tasks.add_task(
            manager.broadcast,
            {"event": "tables_updated"},
            require_tenant_id(),
        )

        return novo_lancamento
