"""Data Loader de precificação para a camada de aplicação de Pedidos (Kôma).

Responsável por ler os dados necessários do banco de dados (produtos, modificadores,
cupons e cashback) e montar o PricingContext puro para o OrderPricingService.
Mantém a separação entre I/O e computação de domínio.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Sequence
from sqlalchemy.orm import Session

from ...domain.orders.pricing import (
    CouponPricingInput,
    ItemPricingInput,
    ModifierPricingInput,
    OrderPricingService,
    PricingContext,
    to_money_decimal,
)
from ...domain.orders.quote import OrderQuote
from ...domain.orders.types import FulfillmentType, normalize_to_fulfillment
from ...models import Cliente, Comanda, Cupom, OpcaoModificador, Produto


class PricingDataLoader:
    """Carrega dados relacionais para alimentar o motor puro de precificação."""

    @staticmethod
    def build_pricing_context(
        db: Session,
        *,
        restaurante_id: int,
        fulfillment: FulfillmentType | str,
        itens_solicitados: Sequence[dict],  # [{"produto_id": ..., "quantidade": ..., "modificador_ids": [...], "observacao": ...}]
        delivery_fee: float | Decimal = 0.0,
        cupom_codigo: str | None = None,
        cliente_telefone: str | None = None,
        cliente_id: str | None = None,
        usar_cashback: bool = False,
        service_tax_rate: float | Decimal = 0.0,
    ) -> PricingContext:
        """Carrega e mapeia entidades do banco para o PricingContext puro."""
        canonical_fulfillment = normalize_to_fulfillment(fulfillment)

        # 1. Carregar produtos
        prod_ids = {str(it.get("produto_id")) for it in itens_solicitados if it.get("produto_id")}
        products_map: dict[str, Produto] = {}
        if prod_ids:
            prods = (
                db.query(Produto)
                .filter(
                    Produto.restaurante_id == restaurante_id,
                    Produto.id.in_(prod_ids),
                )
                .all()
            )
            products_map = {str(p.id): p for p in prods}

        # 2. Carregar modificadores
        all_mod_ids = set()
        for it in itens_solicitados:
            for mid in it.get("modificador_ids") or []:
                all_mod_ids.add(str(mid))

        modifiers_map: dict[str, OpcaoModificador] = {}
        if all_mod_ids:
            mods = (
                db.query(OpcaoModificador)
                .filter(
                    OpcaoModificador.restaurante_id == restaurante_id,
                    OpcaoModificador.id.in_(all_mod_ids),
                    OpcaoModificador.ativo == True,
                )
                .all()
            )
            modifiers_map = {str(m.id): m for m in mods}

        # 3. Montar itens de precificação
        pricing_items: list[ItemPricingInput] = []
        for it in itens_solicitados:
            pid = str(it.get("produto_id"))
            prod = products_map.get(pid)
            prod_name = prod.nome if prod else f"Produto {pid}"
            base_price = to_money_decimal(prod.preco if prod else 0.0)
            quantity = it.get("quantidade") or 1

            mod_inputs: list[ModifierPricingInput] = []
            for mid in it.get("modificador_ids") or []:
                mod_entity = modifiers_map.get(str(mid))
                if mod_entity is not None:
                    mod_inputs.append(
                        ModifierPricingInput(
                            id=mod_entity.id,
                            name=mod_entity.nome,
                            price=to_money_decimal(mod_entity.preco_adicional or 0.0),
                        )
                    )

            pricing_items.append(
                ItemPricingInput(
                    product_id=pid,
                    name=prod_name,
                    base_price=base_price,
                    quantity=quantity,
                    modifiers=tuple(mod_inputs),
                    notes=it.get("observacao"),
                )
            )

        # 4. Carregar cupom
        coupon_input: CouponPricingInput | None = None
        if cupom_codigo:
            clean_code = str(cupom_codigo).strip().upper()
            cupom = (
                db.query(Cupom)
                .filter(
                    Cupom.restaurante_id == restaurante_id,
                    Cupom.codigo == clean_code,
                )
                .first()
            )
            if cupom is not None:
                now_utc = datetime.datetime.now(datetime.timezone.utc)
                is_expired = False
                if cupom.valido_ate:
                    v_ate = cupom.valido_ate
                    if v_ate.tzinfo is None:
                        v_ate = v_ate.replace(tzinfo=datetime.timezone.utc)
                    is_expired = now_utc > v_ate

                limit_reached = (
                    cupom.limite_usos is not None
                    and (cupom.usos_atuais or 0) >= cupom.limite_usos
                )

                has_prev_orders = False
                if cupom.apenas_primeira_compra and cliente_telefone:
                    clean_phone = "".join(filter(str.isdigit, cliente_telefone))
                    prev_count = (
                        db.query(Comanda.id)
                        .filter(
                            Comanda.restaurante_id == restaurante_id,
                            Comanda.delivery_telefone == clean_phone,
                            Comanda.delivery_status != "recusado",
                        )
                        .count()
                    )
                    has_prev_orders = prev_count > 0

                coupon_input = CouponPricingInput(
                    code=cupom.codigo,
                    discount_type=cupom.tipo_desconto,
                    discount_value=to_money_decimal(cupom.valor_desconto),
                    min_order_value=to_money_decimal(cupom.valor_minimo_pedido or 0.0),
                    is_active=bool(cupom.ativo),
                    is_expired=is_expired,
                    is_usage_limit_reached=limit_reached,
                    is_first_purchase_only=bool(cupom.apenas_primeira_compra),
                    customer_has_previous_orders=has_prev_orders,
                )

        # 5. Carregar cashback disponível
        available_cashback = Decimal("0.00")
        if usar_cashback and cliente_id:
            cliente = (
                db.query(Cliente)
                .filter(
                    Cliente.restaurante_id == restaurante_id,
                    Cliente.id == cliente_id,
                )
                .first()
            )
            if cliente and cliente.saldo_cashback:
                available_cashback = to_money_decimal(cliente.saldo_cashback)

        return PricingContext(
            fulfillment=canonical_fulfillment,
            items=tuple(pricing_items),
            delivery_fee=to_money_decimal(delivery_fee),
            coupon=coupon_input,
            available_cashback=available_cashback,
            apply_cashback=usar_cashback and available_cashback > Decimal("0.00"),
            service_tax_rate=to_money_decimal(service_tax_rate),
        )

    @classmethod
    def calculate_order_quote(
        cls,
        db: Session,
        *,
        restaurante_id: int,
        fulfillment: FulfillmentType | str,
        itens_solicitados: Sequence[dict],
        delivery_fee: float | Decimal = 0.0,
        cupom_codigo: str | None = None,
        cliente_telefone: str | None = None,
        cliente_id: str | None = None,
        usar_cashback: bool = False,
        service_tax_rate: float | Decimal = 0.0,
    ) -> OrderQuote:
        """Helper completo que carrega dados e invoca o OrderPricingService puro."""
        context = cls.build_pricing_context(
            db=db,
            restaurante_id=restaurante_id,
            fulfillment=fulfillment,
            itens_solicitados=itens_solicitados,
            delivery_fee=delivery_fee,
            cupom_codigo=cupom_codigo,
            cliente_telefone=cliente_telefone,
            cliente_id=cliente_id,
            usar_cashback=usar_cashback,
            service_tax_rate=service_tax_rate,
        )
        return OrderPricingService.calculate_quote(context)
