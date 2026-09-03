"""Adaptador HTTP do Cardápio Digital (WebAdapter) para o núcleo canônico de Pedidos.

Recebe o payload público da borda HTTP, avalia políticas e limites de borda,
mapeia para CreateOrderCommand, delega ao OrderApplicationService e traduz
OrderDTO / erros de domínio de volta para a resposta HTTP pública padronizada.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
import logging
from typing import Any, Optional
from fastapi import BackgroundTasks, HTTPException, Request, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
)
from ...application.orders.service import OrderApplicationService
from ...database import current_restaurante_id
from ...domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidFulfillmentDetailsError,
    InvalidItemQuantityError,
    InvalidOrderTransitionError,
    MinimumOrderAmountNotMetError,
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
    Comanda,
    ConfiguracaoRestaurante,
    OnlinePaymentIntent,
    Restaurante,
    Usuario,
)
from ...schemas import CardapioPedidoCreate
from ...services.clientes import normalizar_telefone_cliente
from ...services.online_order_policy import evaluate_online_order_policy
from ...services.online_payments import (
    OnlinePaymentConfigurationError,
    OnlinePaymentService,
    OnlinePaymentValidationError,
)
from ...services.online_payments.mercado_pago import MercadoPagoError
from ...services.public_orders import (
    MAX_PUBLIC_ORDERS_PER_IP,
    MAX_PUBLIC_ORDERS_PER_PHONE,
    PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    authenticated_customer,
    client_ip,
    consume_rate_limit,
    enforce_public_order_rate_limits,
    resolve_restaurant_id,
)
from ...services.scheduled_orders import (
    schedule_order_in_session,
    scheduled_for_order,
    validate_schedule_request,
)
from ...timezone_utils import get_operational_now
from ...websocket_manager import manager

logger = logging.getLogger("koma.adapters.web")

MAX_PUBLIC_ORDER_UNITS = 200
ELIGIBLE_ONLINE_ORDER_ROLES = ["admin", "gerente", "caixa", "garcom", "atendente"]


def _order_total(comanda: Comanda) -> float:
    itens_total = sum(float(item.preco_unit or 0) for item in comanda.itens if item.status != "cancelado")
    taxa = float(comanda.delivery_taxa or 0)
    desconto_cupom = float(getattr(comanda, "valor_desconto_cupom", 0) or 0)
    desconto_cashback = float(getattr(comanda, "valor_desconto_cashback", 0) or 0)
    return round(max(0.0, itens_total + taxa - desconto_cupom - desconto_cashback), 2)


def _existing_order_response(db: Session, comanda: Comanda) -> dict[str, Any]:
    intent = db.query(OnlinePaymentIntent).filter(
        OnlinePaymentIntent.restaurante_id == comanda.restaurante_id,
        OnlinePaymentIntent.comanda_id == comanda.id,
    ).first()
    schedule = scheduled_for_order(
        db,
        restaurante_id=comanda.restaurante_id,
        comanda_id=comanda.id,
    )
    return {
        "status": "success",
        "comanda_id": comanda.id,
        "numero_pedido": comanda.numero_pedido,
        "delivery_status": (
            "agendado"
            if schedule is not None and schedule.released_at is None
            else (comanda.delivery_status or "pendente")
        ),
        "scheduled_for": schedule.scheduled_for.isoformat() if schedule is not None else None,
        "tipo": comanda.tipo,
        "cliente_id": comanda.cliente_id,
        "total": _order_total(comanda),
        "mensagem": "Pedido já cadastrado com sucesso!",
        "pagamento": (
            OnlinePaymentService.public_payload(intent)
            if intent else {"status": "pendente_no_atendimento", "cobranca_online": False}
        ),
    }


def _load_existing_idempotent_order(db: Session, rest_id: int, key: str) -> Comanda | None:
    if not key:
        return None
    return (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rest_id,
            Comanda.idempotency_key == key,
        )
        .first()
    )


def _enforce_public_order_rate_limits(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> None:
    """Persiste limites antes da transação do pedido para resistir a payloads inválidos.

    Ownership transacional delegada ao serviço — não fazer commit aqui.
    """
    enforce_public_order_rate_limits(
        db,
        request=request,
        restaurante_id=restaurante_id,
        telefone=telefone,
    )


class CardapioWebAdapter:
    """Adaptador HTTP do Cardápio Digital para criação canônica de pedidos."""

    @classmethod
    def handle_create_public_order(
        cls,
        payload: CardapioPedidoCreate,
        request: Request,
        background_tasks: BackgroundTasks,
        db: Session,
        customer_token: str | None = None,
        request_idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Processa a requisição pública HTTP de criação de pedido pelo Cardápio Web."""
        modalidade = payload.tipo_pedido.strip().lower()
        if modalidade not in {"delivery", "retirada"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="tipo_pedido deve ser 'delivery' ou 'retirada'.",
            )

        endereco_entrega = (payload.endereco_entrega or "").strip()
        if modalidade == "delivery" and not endereco_entrega:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="O endereço de entrega é obrigatório para pedidos de delivery.",
            )

        total_units = sum(item.quantidade for item in payload.itens)
        if total_units > MAX_PUBLIC_ORDER_UNITS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Um pedido online pode conter no máximo {MAX_PUBLIC_ORDER_UNITS} unidades.",
            )

        payload_key = (payload.idempotency_key or "").strip()
        header_key = (request_idempotency_key or "").strip()
        if payload_key and header_key and payload_key != header_key:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A chave idempotente do pedido é inconsistente.",
            )
        idempotency_key = header_key or payload_key
        if idempotency_key and (len(idempotency_key) < 8 or len(idempotency_key) > 128):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A chave idempotente deve possuir entre 8 e 128 caracteres.",
            )

        scheduled_for = getattr(payload, "scheduled_for", None)
        is_scheduled = scheduled_for is not None
        online_payment = payload.forma_pagamento == "online"
        payment_method = (payload.forma_pagamento_detalhe or "").strip().lower()
        if is_scheduled and online_payment:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Pedidos agendados usam pagamento no atendimento nesta versão.",
            )
        if online_payment:
            if payment_method != "pix":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Neste momento o pagamento online disponível é Pix.",
                )
            if not payload.cliente_email:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Informe o e-mail para gerar o pagamento Pix.",
                )
            if not idempotency_key:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="A chave idempotente é obrigatória no pagamento online.",
                )
        elif payment_method != "dinheiro":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Pedidos sem pagamento online só podem usar dinheiro no atendimento.",
            )

        tipo_comanda = "Retirada" if modalidade == "retirada" else "Delivery"
        endereco_comanda = None if modalidade == "retirada" else endereco_entrega

        rest_id = resolve_restaurant_id(str(payload.restaurante_id), None, db)
        token_context = current_restaurante_id.set(rest_id)
        cliente = None
        cliente_nome = payload.cliente_nome
        telefone_clean = normalizar_telefone_cliente(payload.cliente_telefone)
        normalized_schedule = None

        try:
            restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
            if restaurante is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Restaurante não encontrado.",
                )

            if getattr(restaurante, "saas_status", "active") == "suspended":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Restaurante temporariamente suspenso para novos pedidos.",
                )

            if is_scheduled:
                normalized_schedule = validate_schedule_request(
                    db,
                    restaurante_id=rest_id,
                    scheduled_for=scheduled_for,
                )

            existing_comanda = _load_existing_idempotent_order(db, rest_id, idempotency_key)
            if existing_comanda:
                logger.info("Pedido retornado via idempotency_key existente: %s", idempotency_key)
                existing_intent = db.query(OnlinePaymentIntent).filter(
                    OnlinePaymentIntent.restaurante_id == rest_id,
                    OnlinePaymentIntent.comanda_id == existing_comanda.id,
                ).first()
                if online_payment and existing_intent and not existing_intent.external_payment_id:
                    OnlinePaymentService.ensure_pix_created(
                        db,
                        intent=existing_intent,
                        payer_email=payload.cliente_email or "",
                    )
                return _existing_order_response(db, existing_comanda)

            if customer_token:
                _claims, cliente = authenticated_customer(
                    db,
                    raw_token=customer_token,
                    expected_restaurante_id=rest_id,
                )
                telefone_clean = cliente.telefone
                cliente_nome = cliente.nome

            configuracao = db.query(ConfiguracaoRestaurante).filter(
                ConfiguracaoRestaurante.restaurante_id == rest_id,
            ).first()
            policy_now = None
            if normalized_schedule is not None:
                operational_tz = get_operational_now().tzinfo
                policy_now = normalized_schedule.astimezone(operational_tz) if operational_tz else normalized_schedule
            policy = evaluate_online_order_policy(
                restaurante,
                configuracao,
                modalidade=modalidade,
                now=policy_now,
            )
            if not policy.accepting_orders:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=policy.reason or "O restaurante não está aceitando pedidos online no momento.",
                )

            _enforce_public_order_rate_limits(
                db,
                request=request,
                restaurante_id=rest_id,
                telefone=telefone_clean,
            )

            recentes = []
            if not is_scheduled and cliente is not None:
                cinco_minutos_atras = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
                recentes = db.query(Comanda).filter(
                    Comanda.restaurante_id == rest_id,
                    Comanda.cliente_id == cliente.id,
                    Comanda.tipo == tipo_comanda,
                    Comanda.criado_em >= cinco_minutos_atras,
                ).order_by(Comanda.criado_em.desc()).all()

            payload_items_sig = sorted([
                f"{item.produto_id}:{item.observacao}"
                for item in payload.itens
                for _ in range(item.quantidade)
            ])
            for rec in recentes:
                rec_items_sig = sorted([f"{item.produto_id}:{item.observacao}" for item in rec.itens])
                if payload_items_sig == rec_items_sig:
                    logger.info("Pedido duplicado evitado por janela temporal. Retornando pedido id %s", rec.id)
                    return _existing_order_response(db, rec)

            garcom = db.query(Usuario).filter(
                Usuario.restaurante_id == rest_id,
                Usuario.status == "ativo",
                or_(
                    Usuario.role.in_(ELIGIBLE_ONLINE_ORDER_ROLES),
                    Usuario.cargo.in_(ELIGIBLE_ONLINE_ORDER_ROLES),
                ),
            ).first()
            if not garcom:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Restaurante ainda não está pronto para receber pedidos online.",
                )

            payment_account = None
            payment_shift = None
            if online_payment:
                payment_account = OnlinePaymentService.active_account(db, rest_id)
                payment_shift = OnlinePaymentService.open_shift(db, rest_id)

            fulfillment = FulfillmentType.DELIVERY if modalidade == "delivery" else FulfillmentType.PICKUP
            items_input = tuple(
                OrderItemInput(
                    product_id=item.produto_id,
                    quantity=Decimal(str(item.quantidade)),
                    modifier_ids=tuple(item.modificador_ids or ()),
                    notes=item.observacao or "",
                )
                for item in payload.itens
            )

            delivery_input = None
            if modalidade == "delivery":
                delivery_input = DeliveryInput(
                    address=endereco_comanda,
                    neighborhood=payload.bairro,
                    fee=None,
                )

            cmd = CreateOrderCommand(
                restaurant_id=rest_id,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=fulfillment,
                items=items_input,
                customer=CustomerInput(
                    name=cliente_nome,
                    phone=telefone_clean,
                    customer_id=cliente.id if cliente else None,
                ),
                delivery=delivery_input,
                coupon_code=payload.cupom_codigo,
                usar_cashback=bool(payload.usar_cashback),
                payment_method=payload.forma_pagamento_detalhe,
                change_for=str(payload.troco_para) if payload.troco_para is not None else None,
                idempotency_key=idempotency_key or None,
                operator_user_id=garcom.id,
                defer_operational_publish=online_payment or is_scheduled,
            )

            order_dto = OrderApplicationService.create_order(
                db,
                cmd,
                commit=not (online_payment or is_scheduled),
            )

            comanda = (
                db.query(Comanda)
                .filter(
                    Comanda.restaurante_id == rest_id,
                    Comanda.id == order_dto.comanda_id,
                )
                .first()
            )
            numero_pedido = comanda.numero_pedido if comanda else int(order_dto.sequence)
            cliente_id = comanda.cliente_id if comanda else (order_dto.customer.customer_id if order_dto.customer else None)
            payment_intent = None

            if is_scheduled:
                if comanda is None or normalized_schedule is None:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Não foi possível preparar o pedido agendado.",
                    )
                schedule_order_in_session(
                    db,
                    restaurante_id=rest_id,
                    comanda_id=comanda.id,
                    scheduled_for=normalized_schedule,
                )
                db.commit()
                db.refresh(comanda)
            elif online_payment:
                if comanda is None or payment_shift is None or payment_account is None:
                    raise OnlinePaymentConfigurationError("Não foi possível preparar o pagamento do pedido.")
                payment_intent = OnlinePaymentService.create_intent_in_session(
                    db,
                    comanda=comanda,
                    turno=payment_shift,
                    amount=order_dto.total,
                    idempotency_key=idempotency_key,
                )
                db.commit()
                db.refresh(payment_intent)
                payment_intent = OnlinePaymentService.ensure_pix_created(
                    db,
                    intent=payment_intent,
                    payer_email=payload.cliente_email or "",
                    account=payment_account,
                )

        except HTTPException:
            db.rollback()
            raise
        except (ProductNotFoundError, ProductInactiveError, ProductTenantMismatchError) as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Produto '{err.product_id}' não encontrado ou inativo para este estabelecimento.",
            )
        except (ModifierNotFoundError, ModifierInactiveError, ModifierGroupMismatchError) as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Modificador não encontrado ou inativo.",
            )
        except MinimumOrderAmountNotMetError as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(err),
            )
        except (InvalidFulfillmentDetailsError,) as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(err),
            )
        except OnlinePaymentConfigurationError as err:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))
        except (MercadoPagoError, OnlinePaymentValidationError):
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Não foi possível gerar o Pix agora. Tente novamente sem alterar a sacola.",
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
        except InvalidOrderTransitionError as err:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(err),
            )
        except IntegrityError:
            db.rollback()
            concurrent_order = _load_existing_idempotent_order(db, rest_id, idempotency_key)
            if concurrent_order is not None:
                logger.info(
                    "Corrida idempotente resolvida para pedido público: %s",
                    idempotency_key,
                )
                return _existing_order_response(db, concurrent_order)
            logger.exception(
                "Conflito de integridade ao processar pedido público do restaurante %s.",
                rest_id,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O pedido entrou em conflito com outra operação. Tente novamente.",
            )
        except Exception:
            db.rollback()
            logger.exception(
                "Falha inesperada ao processar pedido público do restaurante %s.",
                rest_id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Não foi possível processar o pedido. Tente novamente.",
            )
        finally:
            current_restaurante_id.reset(token_context)

        if not online_payment and not is_scheduled:
            background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rest_id)
            background_tasks.add_task(
                manager.broadcast,
                {"event": "new_delivery_order", "message": f"Novo pedido online de {cliente_nome} recebido!"},
                rest_id,
            )
        if cliente is not None:
            background_tasks.add_task(
                manager.broadcast,
                {
                    "event": "customers_updated",
                    "detail": {
                        "action": "order_linked",
                        "cliente_id": cliente.id,
                    },
                },
                rest_id,
                target_audience="internal",
            )

        return {
            "status": "success",
            "message": (
                "Pedido agendado com sucesso. Ele será liberado no horário escolhido."
                if is_scheduled
                else (
                    "Pix gerado. O pedido será enviado ao restaurante após a confirmação do pagamento."
                    if online_payment else "Pedido enviado e integrado ao caixa com sucesso!"
                )
            ),
            "id": order_dto.comanda_id,
            "comanda_id": order_dto.comanda_id,
            "numero_pedido": numero_pedido,
            "cliente_id": cliente_id,
            "scheduled_for": normalized_schedule.isoformat() if normalized_schedule is not None else None,
            "delivery_status": "agendado" if is_scheduled else None,
            "total": float(order_dto.total),
            "pagamento": (
                OnlinePaymentService.public_payload(payment_intent)
                if online_payment and payment_intent is not None
                else {"status": "pendente_no_atendimento", "cobranca_online": False}
            ),
        }
