"""Adaptador de Pedidos para PDV, Balcão e Venda Direta (PosAdapter).

Recebe requisições de criação de pedidos presenciais e balcão, executa validações
de turno e permissões de operador, mapeia para CreateOrderCommand (channel=POS),
delega ao OrderApplicationService canônico, processa impressões de produção e
emite broadcasts via WebSocket.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
import logging
from typing import Any, Optional
from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ...application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
)
from ...application.orders.service import OrderApplicationService
from ...database import current_restaurante_id, require_tenant_id
from ...domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidFulfillmentDetailsError,
    InvalidItemQuantityError,
    ModifierGroupMismatchError,
    ModifierInactiveError,
    ModifierNotFoundError,
    OrderDomainError,
    ProductInactiveError,
    ProductNotFoundError,
    ProductTenantMismatchError,
)
from ...domain.orders.types import FulfillmentType, OrderChannel
from ...models import (
    CaixaTurno,
    Cliente,
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Mesa,
    Produto,
    Restaurante,
    Usuario,
)
from ...schemas import ComandaDetail, VendaDiretaCreate
from ...security import ensure_permission
from ...services.atendimentos import (
    ensure_atendimento_for_comanda,
    ensure_launch_identity,
)
from ...services.capabilities import has_capability
from ...services.clientes import (
    buscar_cliente_por_id,
    cadastrar_ou_atualizar_cliente,
    normalizar_telefone_cliente,
)
from ...services.printing import (
    PrintingRequestError,
    enqueue_table_receipt,
)
from ...services.shifts import require_open_cash_shift
from ...subscription import subscription_has_printing
from ...timezone_utils import get_operational_now
from ...waiter_permissions import (
    require_waiter_permission,
    waiter_permission_enabled,
)
from ...websocket_manager import manager

logger = logging.getLogger("koma.adapters.pos")


def print_in_background(
    printer_name: str,
    ticket_text: str,
    document_type: str = "producao",
    source_type: str = "pedido",
    source_id: str = "",
    restaurante_id: int | None = None,
):
    try:
        from ...database import SessionLocal
        from ...models import PrintJob, Restaurante

        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            raise ValueError("Background de impressão exige restaurante_id explícito")
        tenant_context = current_restaurante_id.set(restaurante_id)
        db = None
        try:
            db = SessionLocal(restaurante_id=restaurante_id)
            restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
            if restaurante and not subscription_has_printing(
                restaurante_id,
                restaurante.plano,
            ):
                logger.info(
                    "Impressão ignorada para restaurante %s: recurso não incluído no Kôma Pocket.",
                    restaurante_id,
                )
                return

            pj = PrintJob(
                restaurante_id=restaurante_id,
                document_type=document_type,
                destination=printer_name.upper(),
                source_type=source_type,
                source_id=source_id,
                payload_text=ticket_text,
                status="pending",
                idempotency_key=f"bg:{source_id}:{printer_name}:{ticket_text[:20]}",
            )
            db.add(pj)
            db.commit()
        finally:
            if db is not None:
                db.close()
            current_restaurante_id.reset(tenant_context)
    except Exception as exc:
        logger.error(f"[PRINT BACKGROUND ERROR] Falha ao enfileirar job: {exc}")


class PosAdapter:
    """Adaptador de Pedidos para PDV, Balcão e Venda Direta."""

    @classmethod
    async def handle_create_pos_order(
        cls,
        venda_in: VendaDiretaCreate,
        background_tasks: BackgroundTasks,
        db: Session,
        current_user: Usuario,
    ) -> Comanda:
        """Processa a criação de um pedido presencial / balcão via OrderApplicationService."""
        rid = require_tenant_id()
        raw_order_type = (venda_in.tipo or "").strip().lower()
        is_smartpos = venda_in.origem == "smartpos"
        is_counter_sale = raw_order_type in {"balcao", "balcão"}

        if is_smartpos:
            ensure_permission(current_user, "smartpos:receber")
            if not has_capability(db, rid, "smartpos"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="SmartPOS não habilitado para este restaurante.",
                )

        tipo_pedido = {
            "consumo no local": "Consumo no Local",
            "mesa": "Consumo no Local",
            "delivery": "Entrega",
            "entrega": "Entrega",
            "retirada": "Retirada",
            "viagem": "Retirada",
            "balcao": "Retirada",
            "balcão": "Retirada",
        }.get(raw_order_type)

        if tipo_pedido is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tipo de pedido inválido. Use Mesa, Delivery ou Retirada.",
            )

        if tipo_pedido in {"Entrega", "Retirada"} and not (is_smartpos and is_counter_sale):
            require_waiter_permission(
                db,
                current_user,
                "perm_garcom_delivery",
            )

        require_open_cash_shift(db, rid)

        if tipo_pedido == "Consumo no Local" and venda_in.mesa_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Selecione uma mesa para pedidos de consumo no local.",
            )
        if tipo_pedido != "Consumo no Local" and venda_in.mesa_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Pedidos de delivery ou retirada não podem ser vinculados a uma mesa.",
            )

        if tipo_pedido == "Entrega":
            if not (venda_in.identificador or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Informe o nome do cliente para o delivery.",
                )
            if not (venda_in.delivery_telefone or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Informe o telefone do cliente para o delivery.",
                )
            if not (venda_in.delivery_endereco or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Informe o endereço de entrega.",
                )

        if tipo_pedido == "Retirada" and not is_counter_sale:
            if not (venda_in.identificador or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Informe o nome do cliente para a retirada.",
                )
            if not (venda_in.delivery_telefone or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Informe o telefone do cliente para a retirada.",
                )

        effective_identifier = "Balcão" if is_counter_sale else venda_in.identificador
        telefone_cliente = None
        if venda_in.delivery_telefone:
            try:
                telefone_cliente = normalizar_telefone_cliente(venda_in.delivery_telefone)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=str(exc),
                ) from exc

        normalized_idempotency_key = (
            venda_in.idempotency_key.strip() if venda_in.idempotency_key else None
        )

        # 1. Replay rápido de idempotência
        def _ensure_sale_replay_matches(existing_sale: Comanda) -> Comanda:
            existing_items = sorted(
                (
                    item.produto_id,
                    (item.observacao or "").strip(),
                )
                for item in existing_sale.itens
                if item.status != "cancelado"
            )
            requested_items = sorted(
                (
                    item.produto_id,
                    (item.observacao or "").strip(),
                )
                for item in venda_in.itens
            )
            if (
                existing_sale.mesa_id != venda_in.mesa_id
                or existing_sale.tipo != tipo_pedido
                or existing_items != requested_items
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A chave idempotente já foi usada em outro pedido.",
                )
            return existing_sale

        if normalized_idempotency_key:
            existing_sale = (
                db.query(Comanda)
                .options(
                    joinedload(Comanda.itens).joinedload(Item.produto),
                    joinedload(Comanda.criada_por),
                )
                .filter(
                    Comanda.restaurante_id == rid,
                    Comanda.idempotency_key == normalized_idempotency_key,
                )
                .first()
            )
            if existing_sale is not None:
                return _ensure_sale_replay_matches(existing_sale)

        # 2. Resolução de operador / garçom
        garcom_id = venda_in.garcom_id or current_user.id
        garcom = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == rid,
                Usuario.id == garcom_id,
            )
            .first()
        )
        if not garcom:
            garcom_id = current_user.id
            garcom = current_user

        # 3. Mapeamento para CreateOrderCommand
        if tipo_pedido == "Entrega":
            fulfillment = FulfillmentType.DELIVERY
        elif tipo_pedido == "Retirada":
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
            for item in venda_in.itens
        )

        delivery_input = None
        if fulfillment == FulfillmentType.DELIVERY:
            delivery_input = DeliveryInput(
                address=venda_in.delivery_endereco,
                fee=Decimal(str(venda_in.delivery_taxa or 0.0)),
            )

        cmd = CreateOrderCommand(
            restaurant_id=rid,
            channel=OrderChannel.POS,
            fulfillment=fulfillment,
            items=items_input,
            customer=CustomerInput(
                name=effective_identifier,
                phone=telefone_cliente,
                customer_id=venda_in.cliente_id,
            ),
            delivery=delivery_input,
            idempotency_key=normalized_idempotency_key,
            operator_user_id=garcom_id,
            table_id=str(venda_in.mesa_id) if venda_in.mesa_id is not None else None,
        )

        # 4. Delegação ao OrderApplicationService
        try:
            order_dto = OrderApplicationService.create_order(db, cmd, commit=False)

            # Carregar a Comanda completa com relacionamentos
            comanda = (
                db.query(Comanda)
                .options(
                    joinedload(Comanda.itens).joinedload(Item.produto),
                    joinedload(Comanda.lancamentos).joinedload(Lancamento.itens),
                    joinedload(Comanda.criada_por),
                )
                .filter(
                    Comanda.restaurante_id == rid,
                    Comanda.id == order_dto.comanda_id,
                )
                .first()
            )

            # Ajuste de origem caso SmartPOS
            if is_smartpos:
                for lanc in comanda.lancamentos:
                    if lanc.id == order_dto.order_id:
                        lanc.origem = "smartpos"

            # Identificador em consumo local
            if tipo_pedido == "Consumo no Local" and venda_in.mesa_id is not None:
                ensure_atendimento_for_comanda(db, comanda, actor_id=current_user.id)
                lanc_rec = next((l for l in comanda.lancamentos if l.id == order_dto.order_id), None)
                if lanc_rec:
                    ensure_launch_identity(db, lanc_rec)

            db.commit()
            db.refresh(comanda)

        except HTTPException:
            db.rollback()
            raise
        except (ProductNotFoundError, ProductInactiveError, ProductTenantMismatchError) as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Um produto do pedido não está mais disponível.",
            )
        except (ModifierNotFoundError, ModifierInactiveError, ModifierGroupMismatchError) as err:
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
                concurrent_sale = (
                    db.query(Comanda)
                    .options(
                        joinedload(Comanda.itens).joinedload(Item.produto),
                        joinedload(Comanda.criada_por),
                    )
                    .filter(
                        Comanda.restaurante_id == rid,
                        Comanda.idempotency_key == normalized_idempotency_key,
                    )
                    .first()
                )
                if concurrent_sale is not None:
                    return _ensure_sale_replay_matches(concurrent_sale)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Conflito de integridade ao processar a venda direta.",
            )
        except Exception as exc:
            db.rollback()
            logger.exception("Falha inesperada ao processar venda direta no PDV: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Não foi possível processar a venda direta.",
            )

        # 5. Broadcasts de WebSocket
        if venda_in.mesa_id is not None:
            await manager.broadcast(
                {
                    "type": "MESA_UPDATED",
                    "mesa_id": venda_in.mesa_id,
                    "status": "OCUPADA",
                },
                tenant_id=current_user.tenant_id,
            )

        # 6. Impressão de Produção
        itens_cozinha = []
        for it in comanda.itens:
            if it.lancamento_id == order_dto.order_id and it.status != "cancelado":
                dest_val = (
                    it.produto.categoria.destino_impressao
                    if (it.produto and it.produto.categoria)
                    else getattr(it.produto, "local_impressao", getattr(it.produto, "destino", "COZINHA"))
                )
                dest = (dest_val or "COZINHA").upper()
                if dest not in ("NENHUM", "NONE", ""):
                    itens_cozinha.append(it)

        if itens_cozinha and waiter_permission_enabled(
            db,
            current_user,
            "perm_garcom_print",
        ):
            try:
                if tipo_pedido == "Consumo no Local" and venda_in.mesa_id is not None:
                    enqueue_table_receipt(
                        db,
                        rid,
                        venda_in.mesa_id,
                        apenas_valores=False,
                        source_type="pedido",
                        source_id=comanda.id,
                        idempotency_key=f"mesa:auto:comanda:{comanda.id}",
                    )
                    db.commit()
                else:
                    from ...domain.printing import PrintDocumentService
                    from ...domain.printing.models import OrderPrintData, PrintItem as DomainPrintItem

                    p_items = [
                        DomainPrintItem(
                            codigo=it.produto.codigo if hasattr(it.produto, "codigo") else "",
                            nome=it.produto.nome,
                            quantidade=1,
                            preco_unit=it.preco_unit,
                            observacao=it.observacao,
                            cliente_nome=it.cliente_nome,
                            destino_impressao=(
                                it.produto.categoria.destino_impressao
                                if (it.produto and it.produto.categoria)
                                else getattr(it.produto, "local_impressao", getattr(it.produto, "destino", "COZINHA"))
                            ),
                        )
                        for it in itens_cozinha
                    ]
                    doc_data = OrderPrintData(
                        numero_pedido=str(comanda.numero_pedido),
                        mesa="BALCAO",
                        tipo_pedido=tipo_pedido,
                        garcom_nome=garcom.nome if garcom else "CAIXA",
                        horario=get_operational_now().strftime("%H:%M"),
                        itens=p_items,
                        restaurante_nome="KÔMA",
                    )
                    docs = PrintDocumentService.generate_production(doc_data)
                    for dest_name, ticket_text in docs.items():
                        background_tasks.add_task(
                            print_in_background,
                            printer_name=dest_name,
                            ticket_text=ticket_text,
                            document_type="producao",
                            source_type="pedido",
                            source_id=comanda.id,
                            restaurante_id=rid,
                        )
            except PrintingRequestError as print_err:
                logger.warning("Falha ao gerar via canônica da mesa: %s", print_err)
            except Exception as print_err:
                logger.warning("Falha ao gerar impressões de venda direta: %s", print_err)

        background_tasks.add_task(
            manager.broadcast,
            {"event": "tables_updated"},
            rid,
        )
        if comanda.cliente_id is not None:
            background_tasks.add_task(
                manager.broadcast,
                {
                    "event": "customers_updated",
                    "detail": {
                        "action": "order_linked",
                        "cliente_id": comanda.cliente_id,
                    },
                },
                rid,
                target_audience="internal",
            )

        return comanda
