"""Data Loader de validação para a camada de aplicação de Pedidos (Kôma).

Responsável por ler entidades de catálogo, relacionamentos de modificadores,
cupons e regras de estabelecimento para montar o ValidationContext puro.
Mantém as queries e o I/O isolados fora da camada de domínio.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Sequence
from sqlalchemy.orm import Session

from ...domain.orders.pricing import to_money_decimal
from ...domain.orders.types import FulfillmentType, normalize_to_fulfillment
from ...domain.orders.validation import (
    OrderValidationInputItem,
    OrderValidationService,
    ValidatedOrderInput,
    ValidationContext,
    ValidationCoupon,
    ValidationModifier,
    ValidationProduct,
)
from ...models import (
    Cliente,
    Comanda,
    ConfiguracaoRestaurante,
    Cupom,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
)


class ValidationDataLoader:
    """Carrega dados relacionais do banco para alimentar o OrderValidationService puro."""

    @staticmethod
    def build_validation_context(
        db: Session,
        *,
        restaurante_id: int,
        fulfillment: FulfillmentType | str,
        itens_solicitados: Sequence[dict],
        delivery_address: str | None = None,
        delivery_phone: str | None = None,
        cupom_codigo: str | None = None,
        cliente_telefone: str | None = None,
        cliente_id: str | None = None,
        usar_cashback: bool = False,
    ) -> ValidationContext:
        """Carrega e mapeia entidades do banco para o ValidationContext puro."""
        canonical_fulfillment = normalize_to_fulfillment(fulfillment)

        # 1. Carregar Configuração de Pedido Mínimo
        min_delivery_subtotal = Decimal("0.00")
        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id)
            .first()
        )
        if config and config.pedido_minimo:
            min_delivery_subtotal = to_money_decimal(config.pedido_minimo)

        # 2. Carregar Produtos e seus Grupos Permitidos
        prod_ids = {str(it.get("produto_id")) for it in itens_solicitados if it.get("produto_id")}
        catalog_products: dict[str, ValidationProduct] = {}

        if prod_ids:
            # Buscar produtos (sem filtrar por restaurante_id na query inicial para permitir que o
            # OrderValidationService detecte ProductTenantMismatchError explicitamente)
            prods = db.query(Produto).filter(Produto.id.in_(prod_ids)).all()

            # Buscar vínculos produto -> grupos de modificadores
            prod_grupos = (
                db.query(ProdutoGrupoModificador)
                .filter(ProdutoGrupoModificador.produto_id.in_(prod_ids))
                .all()
            )
            grupos_by_prod: dict[str, list[str]] = {}
            for pg in prod_grupos:
                grupos_by_prod.setdefault(str(pg.produto_id), []).append(str(pg.grupo_id))

            for p in prods:
                catalog_products[str(p.id)] = ValidationProduct(
                    id=p.id,
                    restaurant_id=p.restaurante_id,
                    name=p.nome,
                    price=to_money_decimal(p.preco),
                    is_active=bool(p.ativo),
                    allowed_modifier_group_ids=tuple(grupos_by_prod.get(str(p.id), [])),
                )

        # 3. Carregar Modificadores
        all_mod_ids = set()
        for it in itens_solicitados:
            for mid in it.get("modificador_ids") or []:
                all_mod_ids.add(str(mid))

        catalog_modifiers: dict[str, ValidationModifier] = {}
        if all_mod_ids:
            mods = db.query(OpcaoModificador).filter(OpcaoModificador.id.in_(all_mod_ids)).all()
            for m in mods:
                catalog_modifiers[str(m.id)] = ValidationModifier(
                    id=m.id,
                    group_id=str(m.grupo_id),
                    restaurant_id=m.restaurante_id,
                    name=m.nome,
                    price=to_money_decimal(m.preco_adicional or 0.0),
                    is_active=bool(m.ativo),
                )

        # 4. Mapear Itens de Entrada
        validation_items: list[OrderValidationInputItem] = []
        for it in itens_solicitados:
            validation_items.append(
                OrderValidationInputItem(
                    product_id=it.get("produto_id"),
                    quantity=it.get("quantidade") or 1,
                    modifier_ids=tuple(it.get("modificador_ids") or ()),
                    notes=it.get("observacao"),
                )
            )

        # 5. Carregar Cupom
        coupon_input: ValidationCoupon | None = None
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
                if cupom.apenas_primeira_compra and (cliente_telefone or delivery_phone):
                    tel_target = cliente_telefone or delivery_phone
                    clean_phone = "".join(filter(str.isdigit, str(tel_target)))
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

                coupon_input = ValidationCoupon(
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

        # 6. Carregar Cashback
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

        return ValidationContext(
            restaurant_id=restaurante_id,
            fulfillment=canonical_fulfillment,
            items=tuple(validation_items),
            catalog_products=catalog_products,
            catalog_modifiers=catalog_modifiers,
            delivery_address=delivery_address,
            delivery_phone=delivery_phone or cliente_telefone,
            minimum_delivery_subtotal=min_delivery_subtotal,
            coupon=coupon_input,
            available_cashback=available_cashback,
            apply_cashback=usar_cashback and available_cashback > Decimal("0.00"),
        )

    @classmethod
    def validate_order(
        cls,
        db: Session,
        *,
        restaurante_id: int,
        fulfillment: FulfillmentType | str,
        itens_solicitados: Sequence[dict],
        delivery_address: str | None = None,
        delivery_phone: str | None = None,
        cupom_codigo: str | None = None,
        cliente_telefone: str | None = None,
        cliente_id: str | None = None,
        usar_cashback: bool = False,
    ) -> ValidatedOrderInput:
        """Helper completo que carrega dados de catálogo e invoca o OrderValidationService puro."""
        context = cls.build_validation_context(
            db=db,
            restaurante_id=restaurante_id,
            fulfillment=fulfillment,
            itens_solicitados=itens_solicitados,
            delivery_address=delivery_address,
            delivery_phone=delivery_phone,
            cupom_codigo=cupom_codigo,
            cliente_telefone=cliente_telefone,
            cliente_id=cliente_id,
            usar_cashback=usar_cashback,
        )
        return OrderValidationService.validate(context)
