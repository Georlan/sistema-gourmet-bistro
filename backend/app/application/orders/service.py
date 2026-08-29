"""Serviço de aplicação canônico de Pedidos do Kôma (OrderApplicationService).

Orquestra a recepção de comandos de qualquer canal, execução das validações puras,
cálculo monetário, persistência transacional atômica e emissão de eventos de domínio.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Optional, Sequence
import uuid
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...domain.orders.events import (
    OrderAccepted,
    OrderCancelled,
    OrderCompleted,
    OrderCreated,
    OrderDomainEvent,
    OrderPreparing,
    OrderReady,
    OrderRejected,
)
from ...domain.orders.pricing import OrderPricingService, to_money_decimal
from ...domain.orders.state_machine import OrderStateMachine
from ...domain.orders.types import (
    FulfillmentType,
    OrderChannel,
    OrderStatus,
    normalize_to_fulfillment,
    normalize_to_order_status,
    to_legacy_delivery_status,
    to_legacy_fulfillment,
    to_legacy_order_status,
)
from ...domain.orders.validation import OrderValidationService
from ...models import (
    Cliente,
    Comanda,
    HistoricoFidelidade,
    Item,
    ItemModificador,
    Lancamento,
    Usuario,
)
from ...routes.orders import gerar_novo_numero_pedido
from ...services.clientes import (
    cadastrar_ou_atualizar_cliente,
    normalizar_telefone_cliente,
)
from ...services.inventory import consumir_estoque_dos_itens, estornar_estoque_dos_itens
from .commands import (
    AcceptOrderCommand,
    CancelOrderCommand,
    CompleteOrderCommand,
    CreateOrderCommand,
    MarkOrderReadyCommand,
    RejectOrderCommand,
)
from .dto import CustomerDTO, DeliveryDTO, OrderDTO, OrderItemDTO, OrderModifierDTO
from .validation_loader import ValidationDataLoader

ELIGIBLE_ONLINE_ORDER_ROLES = ["admin", "gerente", "caixa", "garcom", "atendente"]


class OrderApplicationService:
    """Orquestrador canônico da aplicação para pedidos."""

    @classmethod
    def create_order(
        cls,
        db: Session,
        cmd: CreateOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Cria e persiste um pedido canônico no banco de dados."""
        # 1. Idempotência / Replay
        if cmd.idempotency_key:
            existing = (
                db.query(Comanda)
                .filter(
                    Comanda.restaurante_id == cmd.restaurant_id,
                    Comanda.idempotency_key == cmd.idempotency_key,
                )
                .first()
            )
            if existing is not None:
                return cls._comanda_to_dto(existing)

        # 2. Normalização e Validação Pura
        clean_phone = (
            normalizar_telefone_cliente(cmd.customer.phone)
            if cmd.customer and cmd.customer.phone
            else None
        )
        delivery_addr = cmd.delivery.address if cmd.delivery else (cmd.customer.address if cmd.customer else None)

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
        delivery_fee = cmd.delivery.fee if cmd.delivery else Decimal("0.00")
        pricing_context = validated_input.to_pricing_context(
            delivery_fee=delivery_fee,
            service_tax_rate=Decimal("0.00"),
        )
        quote = OrderPricingService.calculate_quote(pricing_context)

        # 4. Operador / Garçom para atender requisitos de FK
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

        # 5. Cadastro / Atualização do Cliente
        cliente = None
        if cmd.customer and cmd.customer.name and len(cmd.customer.name.strip()) >= 2:
            cliente = cadastrar_ou_atualizar_cliente(
                db,
                restaurante_id=cmd.restaurant_id,
                telefone=clean_phone or "",
                nome=cmd.customer.name,
                endereco=delivery_addr,
            )

        # 6. Número do Pedido e Identificação
        numero_pedido = gerar_novo_numero_pedido(db, restaurante_id=cmd.restaurant_id)

        # 7. Definição do Tipo e Status Legados
        if cmd.fulfillment == FulfillmentType.PICKUP:
            tipo_comanda = "Retirada"
            auto_delivery_status = "producao"
        elif cmd.fulfillment == FulfillmentType.DELIVERY:
            tipo_comanda = "Delivery"
            auto_delivery_status = "pendente"
        else:
            tipo_comanda = "Mesa"
            auto_delivery_status = None

        comanda_id = str(cmd.check_id) if cmd.check_id else f"c-{uuid.uuid4().hex[:8]}"

        # 8. Persistência da Comanda
        nova_comanda = Comanda(
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
            delivery_taxa=float(quote.delivery_fee),
            cupom_id=None,  # Preenchido se cupom elegível
            valor_desconto_cupom=float(quote.coupon_discount),
            valor_desconto_cashback=float(quote.cashback_discount),
            idempotency_key=cmd.idempotency_key,
        )
        db.add(nova_comanda)
        db.flush()

        # 9. Registro de Cashback no Histórico
        if quote.cashback_discount > Decimal("0.00") and cliente is not None:
            hist = HistoricoFidelidade(
                restaurante_id=cmd.restaurant_id,
                cliente_id=cliente.id,
                _cliente_telefone=cliente.telefone,
                tipo_movimentacao="RESGATE",
                valor_delta=-float(quote.cashback_discount),
                comanda_id=comanda_id,
            )
            db.add(hist)

        # 10. Persistência do Lançamento
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
        origem_legada = _CHANNEL_TO_ORIGEM.get(cmd.channel, "cardapio")

        lancamento_id = f"l-{uuid.uuid4().hex[:8]}"
        novo_lancamento = Lancamento(
            id=lancamento_id,
            restaurante_id=cmd.restaurant_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            origem=origem_legada,
            timestamp=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(novo_lancamento)
        db.flush()

        # 11. Persistência dos Itens e Modificadores
        itens_criados: list[Item] = []
        for v_item in validated_input.items:
            unit_price = float(v_item.base_price + sum(m.price for m in v_item.modifiers))
            qty_int = int(v_item.quantity)
            for _ in range(qty_int):
                item_id = f"i-{uuid.uuid4().hex[:8]}"
                item_db = Item(
                    id=item_id,
                    restaurante_id=cmd.restaurant_id,
                    comanda_id=comanda_id,
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

        # 12. Consumo de Estoque para Pedidos que nascem em Produção
        if auto_delivery_status == "producao":
            consumir_estoque_dos_itens(db, itens_criados, liberar_pendente=True)

        if commit:
            db.commit()
            db.refresh(nova_comanda)

        return cls._comanda_to_dto(nova_comanda, quote=quote)

    @classmethod
    def accept_order(
        cls,
        db: Session,
        cmd: AcceptOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Aceita pedido pendente e transiciona para produção, baixando estoque."""
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == cmd.restaurant_id,
                Comanda.id == str(cmd.order_id),
            )
            .with_for_update()
            .first()
        )
        if not comanda:
            raise ValueError(f"Comanda {cmd.order_id} não encontrada.")

        current_status = normalize_to_order_status(comanda.delivery_status)
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        # Validação formal pela State Machine
        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.PREPARING,
            fulfillment=fulfillment,
        )

        comanda.delivery_status = "producao"

        # Baixar estoque de insumos
        consumir_estoque_dos_itens(db, comanda.itens, liberar_pendente=True)

        if commit:
            db.commit()
            db.refresh(comanda)

        return cls._comanda_to_dto(comanda)

    @classmethod
    def mark_order_ready(
        cls,
        db: Session,
        cmd: MarkOrderReadyCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Sinaliza que os itens do pedido estão prontos."""
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == cmd.restaurant_id,
                Comanda.id == str(cmd.order_id),
            )
            .with_for_update()
            .first()
        )
        if not comanda:
            raise ValueError(f"Comanda {cmd.order_id} não encontrada.")

        current_status = normalize_to_order_status(comanda.delivery_status)
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.READY,
            fulfillment=fulfillment,
        )

        comanda.delivery_status = "pronto"
        for it in comanda.itens:
            if it.status == "preparando":
                it.status = "pronto"

        if commit:
            db.commit()
            db.refresh(comanda)

        return cls._comanda_to_dto(comanda)

    @classmethod
    def cancel_order(
        cls,
        db: Session,
        cmd: CancelOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Cancela um pedido em andamento e estorna estoque se aplicável."""
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == cmd.restaurant_id,
                Comanda.id == str(cmd.order_id),
            )
            .with_for_update()
            .first()
        )
        if not comanda:
            raise ValueError(f"Comanda {cmd.order_id} não encontrada.")

        current_status = normalize_to_order_status(comanda.delivery_status)
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.CANCELLED,
            fulfillment=fulfillment,
        )

        comanda.delivery_status = "recusado"
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)

        itens_cancelados = []
        for it in comanda.itens:
            if it.status != "cancelado":
                it.status = "cancelado"
                itens_cancelados.append(it)

        if cmd.refund_stock and itens_cancelados:
            estornar_estoque_dos_itens(
                db,
                itens_cancelados,
                usuario_id=str(cmd.operator_user_id) if cmd.operator_user_id else None,
            )

        if commit:
            db.commit()
            db.refresh(comanda)

        return cls._comanda_to_dto(comanda)

    @classmethod
    def reject_order(
        cls,
        db: Session,
        cmd: RejectOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Rejeita um pedido pendente sem permitir que entre em produção."""
        cancel_cmd = CancelOrderCommand(
            restaurant_id=cmd.restaurant_id,
            order_id=cmd.order_id,
            reason=cmd.reason,
            operator_user_id=cmd.operator_user_id,
            refund_stock=False,
        )
        return cls.cancel_order(db, cancel_cmd, commit=commit)

    @classmethod
    def complete_order(
        cls,
        db: Session,
        cmd: CompleteOrderCommand,
        *,
        commit: bool = True,
    ) -> OrderDTO:
        """Finaliza um pedido entregue ou concluído."""
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == cmd.restaurant_id,
                Comanda.id == str(cmd.order_id),
            )
            .with_for_update()
            .first()
        )
        if not comanda:
            raise ValueError(f"Comanda {cmd.order_id} não encontrada.")

        current_status = normalize_to_order_status(comanda.delivery_status)
        fulfillment = normalize_to_fulfillment(comanda.tipo)

        OrderStateMachine.validate_transition(
            current_status=current_status,
            target_status=OrderStatus.COMPLETED,
            fulfillment=fulfillment,
        )

        comanda.delivery_status = "finalizado"
        for it in comanda.itens:
            if it.status == "preparando":
                it.status = "pronto"

        if commit:
            db.commit()
            db.refresh(comanda)

        return cls._comanda_to_dto(comanda)

    @classmethod
    def _comanda_to_dto(
        cls,
        comanda: Comanda,
        quote: OrderQuote | None = None,
    ) -> OrderDTO:
        """Mapeia o modelo relacional da Comanda para o OrderDTO canônico."""
        itens_dto: list[OrderItemDTO] = []
        subtotal_calc = Decimal("0.00")

        for it in comanda.itens:
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

        display_num = str(comanda.numero_pedido) if comanda.numero_pedido else None

        return OrderDTO(
            order_id=comanda.id,
            restaurant_id=comanda.restaurante_id,
            display_number=display_num,
            comanda_id=comanda.id,
            channel="cardapio" if comanda.tipo in {"Delivery", "Retirada"} else "mesa",
            fulfillment=to_legacy_fulfillment(normalize_to_fulfillment(comanda.tipo)),
            status=comanda.delivery_status or "pendente",
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
