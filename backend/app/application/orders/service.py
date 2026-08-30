"""Serviço de aplicação canônico de Pedidos do Kôma (OrderApplicationService).

Orquestra a recepção de comandos de qualquer canal, execução das validações puras,
cálculo monetário, persistência transacional atômica e emissão de eventos de domínio.
Garante a separação conceitual canônica entre Comanda (Conta) e Order/Lancamento (Pedido).
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any, Optional, Sequence
import uuid
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...domain.orders.events import (
    OrderAccepted,
    OrderCancelled,
    OrderCompleted,
    OrderCreated,
    OrderDispatched,
    OrderDomainEvent,
    OrderPreparing,
    OrderReady,
    OrderRejected,
)
from ...services.outbox import enqueue_outbox_event_in_session
from ...domain.orders.errors import OrderValidationError
from ...domain.orders.pricing import OrderPricingService, OrderQuote, to_money_decimal
from ...domain.orders.state_machine import OrderStateMachine
from ...domain.orders.types import (
    FulfillmentType,
    OrderChannel,
    OrderStatus,
    format_order_family_id,
    normalize_to_fulfillment,
    normalize_to_order_status,
    sequence_to_letters,
    to_legacy_delivery_status,
    to_legacy_fulfillment,
    to_legacy_order_status,
)
from ...domain.orders.validation import OrderValidationService
from ...models import (
    Cliente,
    Comanda,
    ConfiguracaoRestaurante,
    Cupom,
    HistoricoFidelidade,
    Item,
    ItemModificador,
    Lancamento,
    Restaurante,
    Usuario,
)
from ...services.atendimentos import ensure_launch_identity
from ...services.clientes import (
    cadastrar_ou_atualizar_cliente,
    normalizar_telefone_cliente,
)
from ...services.inventory import consumir_estoque_dos_itens, estornar_estoque_dos_itens
from ...services.online_order_policy import evaluate_online_order_policy
from ...services.order_numbers import gerar_novo_numero_pedido_atomico
from .commands import (
    AcceptOrderCommand,
    CancelOrderCommand,
    CompleteOrderCommand,
    CreateOrderCommand,
    DispatchOrderCommand,
    MarkOrderReadyCommand,
    RejectOrderCommand,
)
from .dto import CustomerDTO, DeliveryDTO, OrderDTO, OrderItemDTO, OrderModifierDTO
from .validation_loader import ValidationDataLoader

ELIGIBLE_ONLINE_ORDER_ROLES = ["admin", "gerente", "caixa", "garcom", "atendente"]

_CHANNEL_TO_ORIGEM = {
    OrderChannel.WEB_CARDAPIO: "cardapio",
    OrderChannel.WAITER: "garcom",
    OrderChannel.POS: "caixa",
    OrderChannel.KIOSK: "cardapio",
    OrderChannel.QR_MESA: "cardapio",
    OrderChannel.IFOOD: "cardapio",
    OrderChannel.NINE_NINE_FOOD: "cardapio",
    OrderChannel.KEETA: "cardapio",
    OrderChannel.WHATSAPP: "cardapio",
    OrderChannel.API: "cardapio",
}


def _parse_troco_para_float(val: Any) -> float | None:
    """Converte valores como 'R$ 50,00', '50.00' ou 50 para float suportado pelo banco."""
    if val is None:
        return None
    if isinstance(val, (int, float, Decimal)):
        return float(val)
    raw = str(val).replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(raw)
    except ValueError:
        return None


class OrderApplicationService:
    """Orquestrador canônico da aplicação para pedidos."""

    @classmethod
    def _event_identity_kwargs(
        cls,
        db: Session,
        lancamento: Lancamento | None,
        comanda: Comanda,
    ) -> dict:
        """Monta os campos canônicos de identidade para eventos de domínio.

        Retorna um dict com: order_id, check_id, display_number, check_number.
        """
        order_id = lancamento.id if lancamento else comanda.id
        check_id = comanda.id
        check_number = comanda.numero_pedido if comanda.numero_pedido else None
        display_number = None
        if lancamento and db is not None:
            try:
                _, display_number = cls._resolve_order_identity(db, lancamento, comanda)
            except Exception:
                pass
        if display_number is None and check_number:
            display_number = format_order_family_id(check_number, 1)
        return {
            "order_id": order_id,
            "check_id": check_id,
            "display_number": display_number,
            "check_number": check_number,
        }

    @classmethod
    def resolve_server_delivery_fee(
        cls,
        db: Session,
        restaurante_id: int,
        fulfillment: FulfillmentType,
        items_subtotal: Decimal,
        neighborhood: Optional[str] = None,
    ) -> Decimal:
        """Calcula de forma autoritativa no servidor a taxa de entrega."""
        if fulfillment != FulfillmentType.DELIVERY:
            return Decimal("0.00")

        restaurante = (
            db.query(Restaurante)
            .filter(Restaurante.id == restaurante_id)
            .first()
        )
        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id)
            .first()
        )
        policy = evaluate_online_order_policy(restaurante, config, modalidade="delivery")

        # 1. Regra de frete grátis por valor de subtotal
        if config and config.frete_gratis_valor and float(config.frete_gratis_valor) > 0:
            if items_subtotal >= to_money_decimal(config.frete_gratis_valor):
                return Decimal("0.00")

        # 2. Regra por tabela de bairros cadastrada
        if neighborhood and config and config.tabela_taxas_bairros:
            clean_bairro = str(neighborhood).strip().casefold()
            for b in config.tabela_taxas_bairros:
                if isinstance(b, dict) and str(b.get("bairro", "")).strip().casefold() == clean_bairro:
                    return to_money_decimal(b.get("taxa", 0.0))

        # 3. Taxa da política online do restaurante
        return to_money_decimal(policy.delivery_fee)

    @classmethod
    def create_order(
        cls,
        db: Session,
        cmd: CreateOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Cria e persiste um pedido canônico (Order / Lançamento) dentro da Comanda."""
        # 1. Idempotência / Replay por Chave Idempotente
        if cmd.idempotency_key:
            existing_lancamento = (
                db.query(Lancamento)
                .filter(
                    Lancamento.restaurante_id == cmd.restaurant_id,
                    Lancamento.idempotency_key == cmd.idempotency_key,
                )
                .first()
            )
            if existing_lancamento is not None:
                comanda = (
                    db.query(Comanda)
                    .filter(
                        Comanda.restaurante_id == cmd.restaurant_id,
                        Comanda.id == existing_lancamento.comanda_id,
                    )
                    .first()
                )
                if comanda:
                    return cls._to_order_dto(db=db, comanda=comanda, lancamento=existing_lancamento)

            # Fallback de idempotência por comanda
            existing_comanda = (
                db.query(Comanda)
                .filter(
                    Comanda.restaurante_id == cmd.restaurant_id,
                    Comanda.idempotency_key == cmd.idempotency_key,
                )
                .first()
            )
            if existing_comanda is not None:
                lanc = (
                    db.query(Lancamento)
                    .filter(Lancamento.comanda_id == existing_comanda.id)
                    .order_by(Lancamento.timestamp.asc())
                    .first()
                )
                return cls._to_order_dto(db=db, comanda=existing_comanda, lancamento=lanc)

        # 2. Validação Pura e Contexto
        delivery_addr = cmd.delivery.address if cmd.delivery else None
        delivery_neighborhood = cmd.delivery.neighborhood if cmd.delivery else None
        clean_phone = (
            normalizar_telefone_cliente(cmd.customer.phone)
            if cmd.customer and cmd.customer.phone
            else None
        )

        itens_solicitados = [
            {
                "produto_id": item.product_id,
                "quantidade": item.quantity,
                "modificador_ids": item.modifier_ids,
                "observacao": item.notes,
            }
            for item in cmd.items
        ]

        val_context = ValidationDataLoader.build_validation_context(
            db=db,
            restaurante_id=cmd.restaurant_id,
            fulfillment=cmd.fulfillment,
            itens_solicitados=itens_solicitados,
            delivery_address=delivery_addr,
            delivery_phone=clean_phone,
            cupom_codigo=cmd.coupon_code,
            cliente_telefone=clean_phone,
            cliente_id=str(cmd.customer.customer_id) if cmd.customer and cmd.customer.customer_id else None,
            usar_cashback=cmd.usar_cashback or cmd.cashback_discount > Decimal("0.00"),
        )

        validated_input = OrderValidationService.validate(val_context)

        # 3. Cotação Financeira Pura
        subtotal_base = sum(
            (it.base_price + sum(m.price for m in it.modifiers)) * it.quantity
            for it in validated_input.items
        )
        authoritative_delivery_fee = cls.resolve_server_delivery_fee(
            db=db,
            restaurante_id=cmd.restaurant_id,
            fulfillment=cmd.fulfillment,
            items_subtotal=subtotal_base,
            neighborhood=delivery_neighborhood,
        )

        pricing_context = validated_input.to_pricing_context(
            delivery_fee=authoritative_delivery_fee,
            service_tax_rate=Decimal("0.00"),
        )
        quote = OrderPricingService.calculate_quote(pricing_context)

        # 4. Operador / Garçom para FKs
        garcom_id = cmd.operator_user_id
        if not garcom_id:
            garcom = (
                db.query(Usuario)
                .filter(
                    Usuario.restaurante_id == cmd.restaurant_id,
                    Usuario.status == "ativo",
                    or_(
                        Usuario.role.in_(ELIGIBLE_ONLINE_ORDER_ROLES),
                        Usuario.cargo.in_(ELIGIBLE_ONLINE_ORDER_ROLES),
                    ),
                )
                .first()
            )
            if garcom:
                garcom_id = garcom.id

        # 5. Cadastro / Atualização do Cliente (Preserva regra de segurança: pedidos web sem OTP não se apropriam de cadastro)
        cliente = None
        if cmd.customer and cmd.customer.customer_id:
            cliente = (
                db.query(Cliente)
                .filter(
                    Cliente.restaurante_id == cmd.restaurant_id,
                    Cliente.id == cmd.customer.customer_id,
                )
                .first()
            )
            if cliente is not None:
                cliente = cadastrar_ou_atualizar_cliente(
                    db,
                    restaurante_id=cmd.restaurant_id,
                    telefone=cliente.telefone,
                    nome=cliente.nome,
                    endereco=delivery_addr,
                )
        elif cmd.channel != OrderChannel.WEB_CARDAPIO and cmd.customer and cmd.customer.name and len(cmd.customer.name.strip()) >= 2 and clean_phone:
            cliente = cadastrar_ou_atualizar_cliente(
                db,
                restaurante_id=cmd.restaurant_id,
                telefone=clean_phone,
                nome=cmd.customer.name,
                endereco=delivery_addr,
            )

        # 6. Resolução da Comanda
        comanda = None
        if cmd.check_id:
            comanda = (
                db.query(Comanda)
                .filter(
                    Comanda.restaurante_id == cmd.restaurant_id,
                    Comanda.id == str(cmd.check_id),
                )
                .with_for_update()
                .first()
            )
            if comanda and comanda.fechada:
                raise OrderValidationError("Não é permitido adicionar pedidos a uma comanda fechada.")

        # Status inicial de comanda e lançamento
        if cmd.channel == OrderChannel.POS:
            if cmd.fulfillment == FulfillmentType.PICKUP:
                tipo_comanda = "Retirada"
                auto_delivery_status = "producao"
                initial_lancamento_status = "producao"
            elif cmd.fulfillment == FulfillmentType.DELIVERY:
                tipo_comanda = "Entrega"
                auto_delivery_status = "producao"
                initial_lancamento_status = "producao"
            else:
                tipo_comanda = "Consumo no Local"
                auto_delivery_status = None
                initial_lancamento_status = "producao"
        elif cmd.fulfillment == FulfillmentType.PICKUP:
            tipo_comanda = "Retirada"
            auto_delivery_status = "pendente"
            initial_lancamento_status = "pendente"
        elif cmd.fulfillment == FulfillmentType.DELIVERY:
            tipo_comanda = "Delivery"
            auto_delivery_status = "pendente"
            initial_lancamento_status = "pendente"
        else:
            tipo_comanda = "Consumo no Local"
            auto_delivery_status = None
            initial_lancamento_status = "producao"

        cupom_db_id = None
        coupon_discount_applied = Decimal("0.00")
        if quote.coupon_discount > Decimal("0.00") and cmd.coupon_code:
            clean_code = cmd.coupon_code.strip()
            # Incremento atômico condicional no banco de dados (protege contra corridas em SQLite e PostgreSQL)
            update_count = (
                db.query(Cupom)
                .filter(
                    Cupom.restaurante_id == cmd.restaurant_id,
                    Cupom.codigo.ilike(clean_code),
                    Cupom.ativo == True,
                    or_(
                        Cupom.limite_usos.is_(None),
                        func.coalesce(Cupom.usos_atuais, 0) < Cupom.limite_usos,
                    ),
                )
                .update(
                    {Cupom.usos_atuais: func.coalesce(Cupom.usos_atuais, 0) + 1},
                    synchronize_session=False,
                )
            )
            if update_count > 0:
                cupom_model = (
                    db.query(Cupom)
                    .filter(
                        Cupom.restaurante_id == cmd.restaurant_id,
                        Cupom.codigo.ilike(clean_code),
                    )
                    .first()
                )
                if cupom_model:
                    cupom_db_id = cupom_model.id
                    coupon_discount_applied = quote.coupon_discount
            else:
                # Limite de usos atingido concorrentemente sob o banco: cupom esgotado
                cupom_db_id = None
                coupon_discount_applied = Decimal("0.00")

        # Atualiza a cotação de forma atômica e consistente com a decisão do banco
        if coupon_discount_applied != quote.coupon_discount:
            new_discount_total = coupon_discount_applied + quote.cashback_discount
            new_total = max(
                Decimal("0.00"),
                quote.subtotal + quote.delivery_fee + quote.service_fee - new_discount_total,
            )
            quote = OrderQuote(
                items=quote.items,
                subtotal=quote.subtotal,
                modifiers_total=quote.modifiers_total,
                coupon_discount=coupon_discount_applied,
                cashback_discount=quote.cashback_discount,
                discount_total=new_discount_total,
                delivery_fee=quote.delivery_fee,
                service_fee=quote.service_fee,
                total=new_total,
            )

        parsed_troco = _parse_troco_para_float(cmd.change_for)

        try:
            if comanda is None:
                comanda_id = str(cmd.check_id) if cmd.check_id else f"c-{uuid.uuid4().hex[:8]}"
                numero_pedido = gerar_novo_numero_pedido_atomico(db, restaurante_id=cmd.restaurant_id)

                comanda = Comanda(
                    id=comanda_id,
                    restaurante_id=cmd.restaurant_id,
                    cliente_id=cliente.id if cliente is not None else None,
                    mesa_id=str(cmd.table_id) if cmd.table_id else None,
                    garcom_id=garcom_id,
                    tipo=tipo_comanda,
                    identificador=cmd.customer.name if cmd.customer else None,
                    numero_pedido=numero_pedido,
                    fechada=False,
                    criado_em=datetime.datetime.now(datetime.timezone.utc),
                    delivery_status=auto_delivery_status,
                    delivery_telefone=clean_phone,
                    delivery_endereco=delivery_addr,
                    delivery_bairro=delivery_neighborhood,
                    delivery_taxa=float(quote.delivery_fee),
                    cupom_id=cupom_db_id,
                    valor_desconto_cupom=float(coupon_discount_applied),
                    valor_desconto_cashback=float(quote.cashback_discount),
                    delivery_forma_pagamento=cmd.payment_method,
                    delivery_troco_para=parsed_troco,
                    idempotency_key=cmd.idempotency_key,
                )
                db.add(comanda)
                db.flush()
            else:
                # Comanda existente (ex: mesa ou segundo pedido)
                if coupon_discount_applied > Decimal("0.00") and cupom_db_id:
                    comanda.cupom_id = cupom_db_id
                    comanda.valor_desconto_cupom = float(coupon_discount_applied)
                if quote.cashback_discount > Decimal("0.00"):
                    comanda.valor_desconto_cashback = float(quote.cashback_discount)

            # 7. Efeitos Transacionais de Cashback no Saldo do Cliente
            if quote.cashback_discount > Decimal("0.00") and cliente is not None:
                cliente.saldo_cashback = max(
                    0.0,
                    round(float(cliente.saldo_cashback or 0.0) - float(quote.cashback_discount), 2),
                )
                hist = HistoricoFidelidade(
                    restaurante_id=cmd.restaurant_id,
                    cliente_id=cliente.id,
                    _cliente_telefone=cliente.telefone,
                    tipo_movimentacao="RESGATE",
                    valor_delta=-float(quote.cashback_discount),
                    comanda_id=comanda.id,
                )
                db.add(hist)

            # 8. Criação do Pedido / Lançamento Canônico (Order != Comanda) com status persistido
            origem_legada = _CHANNEL_TO_ORIGEM.get(cmd.channel, "cardapio")
            lancamento_id = f"l-{uuid.uuid4().hex[:8]}"
            novo_lancamento = Lancamento(
                id=lancamento_id,
                restaurante_id=cmd.restaurant_id,
                comanda_id=comanda.id,
                garcom_id=garcom_id,
                origem=origem_legada,
                status=initial_lancamento_status,
                idempotency_key=cmd.idempotency_key,
                timestamp=datetime.datetime.now(datetime.timezone.utc),
            )
            db.add(novo_lancamento)
            db.flush()

            # Identidade operacional canônica persistida (LancamentoIdentidade para salão, família para delivery/balcão)
            sequence, display_number = cls._resolve_order_identity(db, novo_lancamento, comanda)

            # 9. Persistência dos Itens e Modificadores
            itens_criados: list[Item] = []
            for v_item in validated_input.items:
                unit_price = float(v_item.base_price + sum(m.price for m in v_item.modifiers))
                qty_int = int(v_item.quantity)
                for _ in range(qty_int):
                    item_id = f"i-{uuid.uuid4().hex[:8]}"
                    item_db = Item(
                        id=item_id,
                        restaurante_id=cmd.restaurant_id,
                        comanda_id=comanda.id,
                        lancamento_id=lancamento_id,
                        produto_id=v_item.product_id,
                        preco_unit=unit_price,
                        observacao=v_item.notes or "",
                        cliente_nome=cmd.customer.name if cmd.customer else None,
                        status="preparando",
                        pago=False,
                    )
                    db.add(item_db)
                    itens_criados.append(item_db)

                    for mod in v_item.modifiers:
                        item_mod = ItemModificador(
                            restaurante_id=cmd.restaurant_id,
                            item_id=item_id,
                            opcao_modificador_id=mod.id,
                            preco_aplicado=float(mod.price),
                        )
                        db.add(item_mod)

            db.flush()

            # 10. Consumo de Estoque (pedidos em produção baixam imediatamente, pendentes aguardam aceite)
            consumir_estoque_dos_itens(db, itens_criados, usuario_id=garcom_id, liberar_pendente=False)

            # 11. Transactional Outbox (mesma sessão ACID)
            eid = cls._event_identity_kwargs(db, novo_lancamento, comanda)
            event = OrderCreated(
                restaurant_id=cmd.restaurant_id,
                order_id=eid["order_id"],
                check_id=eid["check_id"],
                display_number=display_number or eid["display_number"],
                check_number=eid["check_number"],
                channel=cmd.channel,
                fulfillment=cmd.fulfillment,
                total=quote.total,
                items_count=len(cmd.items),
                table_id=cmd.table_id,
                customer_name=cmd.customer.name if cmd.customer else None,
                customer_phone=cmd.customer.phone if cmd.customer else None,
                idempotency_key=cmd.idempotency_key,
            )
            enqueue_outbox_event_in_session(
                db,
                event,
                aggregate_type="order",
                aggregate_id=str(novo_lancamento.id),
            )

            if commit:
                db.commit()
                db.refresh(comanda)
                db.refresh(novo_lancamento)

        except IntegrityError:
            db.rollback()
            if cmd.idempotency_key:
                # Corrida concorrente detectada: buscar vencedor
                winner = (
                    db.query(Lancamento)
                    .filter(
                        Lancamento.restaurante_id == cmd.restaurant_id,
                        Lancamento.idempotency_key == cmd.idempotency_key,
                    )
                    .first()
                )
                if winner:
                    comanda = (
                        db.query(Comanda)
                        .filter(
                            Comanda.restaurante_id == cmd.restaurant_id,
                            Comanda.id == winner.comanda_id,
                        )
                        .first()
                    )
                    if comanda:
                        return cls._to_order_dto(db=db, comanda=comanda, lancamento=winner)
            raise

        return cls._to_order_dto(
            db=db,
            comanda=comanda,
            lancamento=novo_lancamento,
            sequence=sequence,
            display_number=display_number,
            quote=quote,
        )

    @classmethod
    def accept_order(
        cls,
        db: Session,
        cmd: AcceptOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Aceita pedido pendente com escopo no lançamento e transiciona para produção."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, cmd.restaurant_id, cmd.order_id)
        if not comanda:
            raise ValueError(f"Pedido/Comanda {cmd.order_id} não encontrado.")

        current_status = normalize_to_order_status(
            lancamento.status if lancamento and lancamento.status else comanda.delivery_status
        )
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.PREPARING,
            fulfillment=fulfillment,
        )

        if lancamento:
            lancamento.status = "producao"

        comanda.delivery_status = "producao"

        target_items = [it for it in comanda.itens if it.lancamento_id == lancamento.id] if lancamento else comanda.itens
        consumir_estoque_dos_itens(db, target_items, liberar_pendente=True)
        eid = cls._event_identity_kwargs(db, lancamento, comanda)
        event = OrderAccepted(
            restaurant_id=cmd.restaurant_id,
            order_id=eid["order_id"],
            check_id=eid["check_id"],
            display_number=eid["display_number"],
            check_number=eid["check_number"],
            operator_user_id=cmd.operator_user_id,
            estimated_prep_minutes=cmd.estimated_prep_minutes,
        )
        enqueue_outbox_event_in_session(
            db,
            event,
            aggregate_type="order",
            aggregate_id=str(eid["order_id"]),
        )

        if commit:
            db.commit()
            db.refresh(comanda)
            if lancamento:
                db.refresh(lancamento)

        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def mark_order_ready(
        cls,
        db: Session,
        cmd: MarkOrderReadyCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Sinaliza que os itens do pedido/lançamento estão prontos."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, cmd.restaurant_id, cmd.order_id)
        if not comanda:
            raise ValueError(f"Pedido/Comanda {cmd.order_id} não encontrado.")

        current_status = normalize_to_order_status(
            lancamento.status if lancamento and lancamento.status else comanda.delivery_status
        )
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.READY,
            fulfillment=fulfillment,
        )

        if lancamento:
            lancamento.status = "pronto"

        target_items = [it for it in comanda.itens if it.lancamento_id == lancamento.id] if lancamento else comanda.itens
        for it in target_items:
            if it.status == "preparando":
                it.status = "pronto"

        active_items = [it for it in comanda.itens if it.status != "cancelado"]
        if active_items and all(it.status == "pronto" for it in active_items):
            comanda.delivery_status = "pronto"

        eid = cls._event_identity_kwargs(db, lancamento, comanda)
        event = OrderReady(
            restaurant_id=cmd.restaurant_id,
            order_id=eid["order_id"],
            check_id=eid["check_id"],
            display_number=eid["display_number"],
            check_number=eid["check_number"],
            fulfillment=fulfillment,
            customer_name=comanda.identificador,
            customer_phone=comanda.delivery_telefone,
        )
        enqueue_outbox_event_in_session(
            db,
            event,
            aggregate_type="order",
            aggregate_id=str(eid["order_id"]),
        )

        if commit:
            db.commit()
            db.refresh(comanda)
            if lancamento:
                db.refresh(lancamento)

        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def cancel_order(
        cls,
        db: Session,
        cmd: CancelOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Cancela um pedido/lançamento e estorna estoque exclusivamente dos seus itens."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, cmd.restaurant_id, cmd.order_id)
        if not comanda:
            raise ValueError(f"Pedido/Comanda {cmd.order_id} não encontrado.")

        current_status = normalize_to_order_status(
            lancamento.status if lancamento and lancamento.status else comanda.delivery_status
        )
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.CANCELLED,
            fulfillment=fulfillment,
        )

        if lancamento:
            lancamento.status = "cancelado"

        target_items = [it for it in comanda.itens if it.lancamento_id == lancamento.id] if lancamento else comanda.itens

        itens_cancelados = []
        for it in target_items:
            if it.status != "cancelado":
                it.status = "cancelado"
                itens_cancelados.append(it)

        if cmd.refund_stock and itens_cancelados:
            estornar_estoque_dos_itens(
                db,
                itens_cancelados,
                usuario_id=str(cmd.operator_user_id) if cmd.operator_user_id else None,
            )

        active_items = [it for it in comanda.itens if it.status != "cancelado"]
        if not active_items:
            comanda.delivery_status = "recusado"
            comanda.fechada = True
            comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)

        eid = cls._event_identity_kwargs(db, lancamento, comanda)
        event = OrderCancelled(
            restaurant_id=cmd.restaurant_id,
            order_id=eid["order_id"],
            check_id=eid["check_id"],
            display_number=eid["display_number"],
            check_number=eid["check_number"],
            reason=cmd.reason or "Cancelado pela operação",
            operator_user_id=cmd.operator_user_id,
            refunded_stock=cmd.refund_stock,
        )
        enqueue_outbox_event_in_session(
            db,
            event,
            aggregate_type="order",
            aggregate_id=str(eid["order_id"]),
        )

        if commit:
            db.commit()
            db.refresh(comanda)
            if lancamento:
                db.refresh(lancamento)

        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def reject_order(
        cls,
        db: Session,
        cmd: RejectOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Rejeita pedido pendente marcando status canônico como 'recusado'."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, cmd.restaurant_id, cmd.order_id)
        if not comanda:
            raise ValueError(f"Pedido/Comanda {cmd.order_id} não encontrado.")

        current_status = normalize_to_order_status(
            lancamento.status if lancamento and lancamento.status else comanda.delivery_status
        )
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.REJECTED,
            fulfillment=fulfillment,
        )

        if lancamento:
            lancamento.status = "recusado"

        target_items = [it for it in comanda.itens if it.lancamento_id == lancamento.id] if lancamento else comanda.itens
        for it in target_items:
            if it.status != "cancelado":
                it.status = "cancelado"

        active_items = [it for it in comanda.itens if it.status != "cancelado"]
        if not active_items:
            comanda.delivery_status = "recusado"
            comanda.fechada = True
            comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)

        eid = cls._event_identity_kwargs(db, lancamento, comanda)
        event = OrderRejected(
            restaurant_id=cmd.restaurant_id,
            order_id=eid["order_id"],
            check_id=eid["check_id"],
            display_number=eid["display_number"],
            check_number=eid["check_number"],
            reason=cmd.reason or "Recusado pelo restaurante",
            operator_user_id=cmd.operator_user_id,
            customer_phone=comanda.delivery_telefone,
        )
        enqueue_outbox_event_in_session(
            db,
            event,
            aggregate_type="order",
            aggregate_id=str(eid["order_id"]),
        )

        if commit:
            db.commit()
            db.refresh(comanda)
            if lancamento:
                db.refresh(lancamento)

        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def dispatch_order(
        cls,
        db: Session,
        cmd: DispatchOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Despacha um pedido de delivery para entrega com motoboy (transição para transito)."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, cmd.restaurant_id, cmd.order_id)
        if not comanda:
            raise ValueError(f"Pedido/Comanda {cmd.order_id} não encontrado.")

        current_status = normalize_to_order_status(
            lancamento.status if lancamento and lancamento.status else comanda.delivery_status
        )
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.DISPATCHED,
            fulfillment=fulfillment,
        )

        if lancamento and lancamento.status in ("pendente", "producao"):
            lancamento.status = "pronto"

        comanda.delivery_status = "transito"
        if cmd.courier_id is not None:
            try:
                comanda.motoboy_id = int(cmd.courier_id)
            except (ValueError, TypeError):
                pass

        eid = cls._event_identity_kwargs(db, lancamento, comanda)
        event = OrderDispatched(
            restaurant_id=cmd.restaurant_id,
            order_id=eid["order_id"],
            check_id=eid["check_id"],
            display_number=eid["display_number"],
            check_number=eid["check_number"],
            courier_id=int(cmd.courier_id) if cmd.courier_id is not None else None,
            customer_name=comanda.identificador,
            customer_phone=comanda.delivery_telefone,
        )
        enqueue_outbox_event_in_session(
            db,
            event,
            aggregate_type="order",
            aggregate_id=str(eid["order_id"]),
        )

        if commit:
            db.commit()
            db.refresh(comanda)
            if lancamento:
                db.refresh(lancamento)

        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def complete_order(
        cls,
        db: Session,
        cmd: CompleteOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Finaliza um pedido entregue ou concluído."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, cmd.restaurant_id, cmd.order_id)
        if not comanda:
            raise ValueError(f"Pedido/Comanda {cmd.order_id} não encontrado.")

        current_status = normalize_to_order_status(
            lancamento.status if lancamento and lancamento.status else comanda.delivery_status
        )
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.COMPLETED,
            fulfillment=fulfillment,
        )

        if lancamento:
            lancamento.status = "finalizado"

        target_items = [it for it in comanda.itens if it.lancamento_id == lancamento.id] if lancamento else comanda.itens
        for it in target_items:
            if it.status == "preparando":
                it.status = "pronto"

        active_launches = [
            l for l in (comanda.lancamentos or [])
            if (l.status or "pendente") not in {"cancelado", "recusado"}
        ]
        if active_launches and all(l.status == "finalizado" for l in active_launches):
            comanda.delivery_status = "finalizado"

        eid = cls._event_identity_kwargs(db, lancamento, comanda)
        event = OrderCompleted(
            restaurant_id=cmd.restaurant_id,
            order_id=eid["order_id"],
            check_id=eid["check_id"],
            display_number=eid["display_number"],
            check_number=eid["check_number"],
            operator_user_id=cmd.operator_user_id,
        )
        enqueue_outbox_event_in_session(
            db,
            event,
            aggregate_type="order",
            aggregate_id=str(eid["order_id"]),
        )

        if commit:
            db.commit()
            db.refresh(comanda)
            if lancamento:
                db.refresh(lancamento)

        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def get_order(
        cls,
        db: Session,
        restaurant_id: int,
        order_id: str | int,
    ) -> Optional[OrderDTO]:
        """Recupera um pedido de forma canônica."""
        lancamento, comanda = cls._resolve_lancamento_and_comanda(db, restaurant_id, order_id)
        if not comanda:
            return None
        return cls._to_order_dto(db=db, comanda=comanda, lancamento=lancamento)

    @classmethod
    def _resolve_lancamento_and_comanda(
        cls,
        db: Session,
        restaurant_id: int,
        order_id: str | int,
    ) -> tuple[Lancamento | None, Comanda | None]:
        """Resolve se o order_id é um Lancamento.id (canônico) ou Comanda.id (legado)."""
        order_id_str = str(order_id)
        lancamento = (
            db.query(Lancamento)
            .filter(
                Lancamento.restaurante_id == restaurant_id,
                Lancamento.id == order_id_str,
            )
            .first()
        )
        if lancamento:
            comanda = (
                db.query(Comanda)
                .filter(
                    Comanda.restaurante_id == restaurant_id,
                    Comanda.id == lancamento.comanda_id,
                )
                .with_for_update()
                .first()
            )
            return lancamento, comanda

        # Fallback legado: order_id passado é a comanda
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == restaurant_id,
                Comanda.id == order_id_str,
            )
            .with_for_update()
            .first()
        )
        if comanda:
            first_launch = (
                db.query(Lancamento)
                .filter(Lancamento.comanda_id == comanda.id)
                .order_by(Lancamento.timestamp.asc())
                .first()
            )
            return first_launch, comanda

        return None, None

    @classmethod
    def _resolve_order_identity(
        cls,
        db: Session,
        lancamento: Lancamento,
        comanda: Comanda,
    ) -> tuple[int, str]:
        """Resolve a identidade canônica (sequence, display_number) do pedido."""
        if comanda.tipo == "Consumo no Local" and comanda.mesa_id:
            identity = ensure_launch_identity(db, lancamento)
            return identity.sequencia, identity.label

        # Para Delivery / Retirada ou quando não há atendimento de mesa
        launches = (
            db.query(Lancamento.id)
            .filter(Lancamento.comanda_id == comanda.id)
            .order_by(Lancamento.timestamp.asc(), Lancamento.id.asc())
            .all()
        )
        launch_ids = [l[0] for l in launches]
        try:
            seq = launch_ids.index(lancamento.id) + 1
        except ValueError:
            seq = len(launch_ids) or 1

        label = (
            format_order_family_id(comanda.numero_pedido, seq)
            if comanda.numero_pedido
            else f"{seq}"
        )
        return seq, label

    @classmethod
    def _to_order_dto(
        cls,
        db: Session | None,
        comanda: Comanda,
        lancamento: Lancamento | None = None,
        sequence: int | None = None,
        display_number: str | None = None,
        quote: OrderQuote | None = None,
    ) -> OrderDTO:
        """Mapeia Lancamento + Comanda para o OrderDTO canônico."""
        if (sequence is None or display_number is None) and lancamento and db is not None:
            sequence, display_number = cls._resolve_order_identity(db, lancamento, comanda)
        elif sequence is None:
            sequence = 1
            display_number = f"{comanda.numero_pedido}-A" if comanda.numero_pedido else None

        if display_number is None and comanda.numero_pedido:
            display_number = format_order_family_id(comanda.numero_pedido, sequence)

        target_items = (
            [it for it in comanda.itens if it.lancamento_id == lancamento.id]
            if lancamento and comanda.itens
            else comanda.itens
        )

        itens_dto: list[OrderItemDTO] = []
        subtotal_calc = Decimal("0.00")

        for it in target_items:
            mods_dto: list[OrderModifierDTO] = []
            for m in getattr(it, "modificadores", []):
                mod_op = getattr(m, "opcao", None)
                mod_name = mod_op.nome if mod_op else f"Mod {m.opcao_modificador_id}"
                mods_dto.append(
                    OrderModifierDTO(
                        modifier_id=m.opcao_modificador_id,
                        name=mod_name,
                        price=to_money_decimal(m.preco_aplicado or 0.0),
                    )
                )

            it_price = to_money_decimal(it.preco_unit or 0.0)
            if it.status != "cancelado":
                subtotal_calc += it_price

            prod = getattr(it, "produto", None)
            prod_name = prod.nome if prod else f"Produto {it.produto_id}"

            itens_dto.append(
                OrderItemDTO(
                    item_id=it.id,
                    product_id=it.produto_id,
                    product_name=prod_name,
                    quantity=Decimal("1.00"),
                    unit_price=it_price,
                    total_price=it_price,
                    modifiers=tuple(mods_dto),
                    notes=it.observacao,
                    status=it.status or "ativo",
                )
            )

        delivery_fee = to_money_decimal(comanda.delivery_taxa or 0.0)
        desc_cupom = to_money_decimal(comanda.valor_desconto_cupom or 0.0)
        desc_cashback = to_money_decimal(comanda.valor_desconto_cashback or 0.0)
        discount_total = desc_cupom + desc_cashback

        total_calc = to_money_decimal(
            max(Decimal("0.00"), subtotal_calc + delivery_fee - discount_total)
        )

        customer_dto = None
        if comanda.cliente_id or comanda.identificador or comanda.delivery_telefone:
            customer_dto = CustomerDTO(
                id=comanda.cliente_id,
                name=comanda.identificador,
                phone=comanda.delivery_telefone,
                address=comanda.delivery_endereco,
            )

        delivery_dto = None
        if comanda.delivery_endereco or comanda.tipo in {"Delivery", "Entrega"}:
            delivery_dto = DeliveryDTO(
                address=comanda.delivery_endereco,
                fee=delivery_fee,
                status=comanda.delivery_status or "waiting",
            )

        order_id_val = lancamento.id if lancamento else comanda.id
        status_val = (
            comanda.delivery_status
            if comanda.tipo in {"Delivery", "Entrega"} and comanda.delivery_status in {"transito", "saiu_entrega"}
            else (lancamento.status if lancamento and lancamento.status else (comanda.delivery_status or "pendente"))
        )

        channel_val = (
            lancamento.origem
            if lancamento and getattr(lancamento, "origem", None)
            else ("cardapio" if comanda.tipo in {"Delivery", "Retirada"} else "mesa")
        )

        return OrderDTO(
            order_id=order_id_val,
            restaurant_id=comanda.restaurante_id,
            display_number=display_number,
            sequence=sequence,
            comanda_id=comanda.id,
            channel=channel_val,
            fulfillment=to_legacy_fulfillment(normalize_to_fulfillment(comanda.tipo)),
            status=status_val,
            total=quote.total if quote else total_calc,
            subtotal=quote.subtotal if quote else subtotal_calc,
            discount=quote.discount_total if quote else discount_total,
            delivery_fee=quote.delivery_fee if quote else delivery_fee,
            service_fee=quote.service_fee if quote else Decimal("0.00"),
            items=tuple(itens_dto),
            customer=customer_dto,
            delivery=delivery_dto,
            table_id=comanda.mesa_id,
            check_id=comanda.id,
            created_at=str(comanda.criado_em) if comanda.criado_em else None,
        )
