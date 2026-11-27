"""Tests for Wave 4 Pizza Mode (meio_a_meio pricing, per-size limits, ticket rendering)."""
from decimal import Decimal
import uuid

from fastapi.testclient import TestClient
import pytest

from app.application.orders.commands import CreateOrderCommand, CustomerInput, OrderItemInput
from app.application.orders.service import OrderApplicationService
from app.catalog_addons import effective_modifier_payloads_by_product
from app.database import SessionLocal, current_restaurante_id
from app.domain.orders.composition import SelectedModifier, composition_presentation
from app.domain.orders.pricing import (
    ItemPricingInput,
    ModifierPricingInput,
    OrderPricingService,
    PricingContext,
)
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.domain.orders.validation import (
    OrderValidationInputItem,
    OrderValidationService,
    ValidationContext,
    ValidationModifier,
    ValidationProduct,
)
from app.main import app
from app.models import (
    Categoria,
    ConfiguracaoRestaurante,
    GrupoModificador,
    Item,
    ItemModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    Usuario,
)
from app.routes.auth import create_access_token

client = TestClient(app)
TENANT_PIZZA = 995


@pytest.fixture(autouse=True)
def setup_pizza_tenant():
    db = SessionLocal()
    try:
        token = current_restaurante_id.set(TENANT_PIZZA)
        try:
            if not db.query(Restaurante).filter_by(id=TENANT_PIZZA).first():
                db.add(Restaurante(id=TENANT_PIZZA, nome="Pizzaria QA Test", slug="pizza-qa-995", plano="pro"))
                db.flush()
            if not db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=TENANT_PIZZA).first():
                db.add(ConfiguracaoRestaurante(restaurante_id=TENANT_PIZZA))
                db.flush()
            if not db.query(Usuario).filter_by(id="admin-pizza-995").first():
                db.add(
                    Usuario(
                        id="admin-pizza-995",
                        restaurante_id=TENANT_PIZZA,
                        nome="Admin Pizza",
                        email="admin995@koma.test",
                        cargo="admin",
                        status="ativo",
                    )
                )
                db.flush()
            db.query(ItemModificador).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.query(Item).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.query(ProdutoGrupoModificador).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.query(Produto).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.query(OpcaoModificador).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.query(GrupoModificador).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.query(Categoria).filter_by(restaurante_id=TENANT_PIZZA).delete()
            db.commit()
        finally:
            current_restaurante_id.reset(token)
        yield
    finally:
        db.close()


def _admin_headers():
    token = create_access_token(
        subject="admin-pizza-995",
        restaurante_id=TENANT_PIZZA,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}", "X-Restaurant-Id": str(TENANT_PIZZA)}


def test_domain_meio_a_meio_pricing_rules_and_odd_cents():
    sabores = [
        ModifierPricingInput(id="s1", name="Calabresa", price=Decimal("42.00"), group_id="g1", group_type="meio_a_meio", meio_a_meio_pricing_rule="maior_preco"),
        ModifierPricingInput(id="s2", name="Camarao", price=Decimal("68.00"), group_id="g1", group_type="meio_a_meio", meio_a_meio_pricing_rule="maior_preco"),
        ModifierPricingInput(id="b1", name="Borda Catupiry", price=Decimal("12.00"), group_id="g2", group_type="opcional"),
    ]
    quote_max = OrderPricingService.calculate_quote(
        PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(ItemPricingInput(product_id="p1", name="Pizza G", base_price=Decimal("10.00"), quantity=1, modifiers=tuple(sabores)),),
        )
    )
    # 10 base + max(42, 68) + 12 borda = 90.00
    assert quote_max.subtotal == Decimal("90.00")
    assert quote_max.modifiers_total == Decimal("80.00")
    assert sum((m.unit_price for m in quote_max.items[0].modifiers), Decimal("0.00")) == Decimal("80.00")

    sabores_media = tuple(
        ModifierPricingInput(
            id=f"s{i}",
            name=f"Sabor {i}",
            price=price,
            group_id="g1",
            group_type="meio_a_meio",
            meio_a_meio_pricing_rule="media",
        )
        for i, price in enumerate((Decimal("10.00"), Decimal("10.00"), Decimal("11.00")), start=1)
    )
    quote_media = OrderPricingService.calculate_quote(
        PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(ItemPricingInput(product_id="p1", name="Pizza G", base_price=Decimal("20.00"), quantity=1, modifiers=sabores_media),),
        )
    )
    # (10 + 10 + 11) / 3 = 10.33 -> 20 + 10.33 = 30.33
    assert quote_media.modifiers_total == Decimal("10.33")
    assert quote_media.subtotal == Decimal("30.33")
    assert sum((m.unit_price for m in quote_media.items[0].modifiers), Decimal("0.00")) == Decimal("10.33")

    sabores_soma = tuple(
        ModifierPricingInput(
            id=f"s{i}",
            name=f"Sabor {i}",
            price=price,
            group_id="g1",
            group_type="meio_a_meio",
            meio_a_meio_pricing_rule="soma",
        )
        for i, price in enumerate((Decimal("20.00"), Decimal("25.00")), start=1)
    )
    quote_soma = OrderPricingService.calculate_quote(
        PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(ItemPricingInput(product_id="p1", name="Pizza G", base_price=Decimal("10.00"), quantity=1, modifiers=sabores_soma),),
        )
    )
    assert quote_soma.modifiers_total == Decimal("45.00")
    assert quote_soma.subtotal == Decimal("55.00")


def test_validation_service_uses_meio_a_meio_pricing_rule_for_minimum_subtotal():
    ctx = ValidationContext(
        restaurant_id=TENANT_PIZZA,
        fulfillment=FulfillmentType.DELIVERY,
        delivery_address="Rua Pizza, 100",
        delivery_phone="85999990000",
        minimum_delivery_subtotal=Decimal("50.00"),
        items=(OrderValidationInputItem(product_id="p1", quantity=1, modifier_ids=("s1", "s2")),),
        catalog_products={
            "p1": ValidationProduct(
                id="p1",
                restaurant_id=TENANT_PIZZA,
                name="Pizza G",
                price=Decimal("10.00"),
                is_active=True,
                allowed_modifier_group_ids=("g1",),
                modifier_selection_limits=(("g1", 1, 2, "tipos"),),
            )
        },
        catalog_modifiers={
            "s1": ValidationModifier(id="s1", group_id="g1", restaurant_id=TENANT_PIZZA, name="Calabresa", price=Decimal("30.00"), is_active=True, group_type="meio_a_meio", meio_a_meio_pricing_rule="maior_preco"),
            "s2": ValidationModifier(id="s2", group_id="g1", restaurant_id=TENANT_PIZZA, name="Camarao", price=Decimal("50.00"), is_active=True, group_type="meio_a_meio", meio_a_meio_pricing_rule="maior_preco"),
        },
    )
    validated = OrderValidationService.validate(ctx)
    quote = OrderPricingService.calculate_quote(validated.to_pricing_context())
    assert quote.subtotal == Decimal("60.00")


def test_api_preserves_meio_a_meio_rule_and_per_product_limits_and_persists_order():
    headers = _admin_headers()
    db = SessionLocal()
    try:
        t = current_restaurante_id.set(TENANT_PIZZA)
        try:
            db.add(Categoria(id="cat-pizza", restaurante_id=TENANT_PIZZA, nome="Pizzas", destino_impressao="COZINHA"))
            db.add(Produto(id="pizza-m", restaurante_id=TENANT_PIZZA, nome="Pizza Média", categoria_id="cat-pizza", preco=10.0, ativo=True))
            db.add(Produto(id="pizza-g", restaurante_id=TENANT_PIZZA, nome="Pizza Grande", categoria_id="cat-pizza", preco=15.0, ativo=True))
            db.commit()
        finally:
            current_restaurante_id.reset(t)
    finally:
        db.close()

    res = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Sabores",
            "tipo": "meio_a_meio",
            "regra_preco_meio_a_meio": "media",
            "min_selecoes": 1,
            "max_selecoes": 2,
            "opcoes": [
                {"nome": "Mussarela", "preco_adicional": 40.0, "ativo": True},
                {"nome": "Camarão", "preco_adicional": 60.0, "ativo": True},
                {"nome": "Quatro Queijos", "preco_adicional": 50.0, "ativo": True},
            ],
            "produto_ids": ["pizza-m", "pizza-g"],
        },
    )
    assert res.status_code == 201, res.text
    created_group = res.json()
    assert created_group["tipo"] == "meio_a_meio"
    assert created_group["regra_preco_meio_a_meio"] == "media"
    option_ids = {op["nome"]: op["id"] for op in created_group["opcoes"]}

    # Configure per-size limit on Pizza Grande (up to 3 flavors) and confirm tipo="meio_a_meio" is NOT clobbered
    db = SessionLocal()
    try:
        t = current_restaurante_id.set(TENANT_PIZZA)
        try:
            link_g = (
                db.query(ProdutoGrupoModificador)
                .filter_by(restaurante_id=TENANT_PIZZA, produto_id="pizza-g", grupo_id=created_group["id"])
                .one()
            )
            link_g.min_selecoes = 1
            link_g.max_selecoes = 3
            link_g.modo_selecao = "tipos"
            db.commit()

            payloads = effective_modifier_payloads_by_product(
                db, TENANT_PIZZA, db.query(Produto).filter_by(restaurante_id=TENANT_PIZZA).all()
            )
            grp_g = payloads["pizza-g"][0]
            assert grp_g["tipo"] == "meio_a_meio"
            assert grp_g["max_selecoes"] == 3
            assert grp_g["regra_preco_meio_a_meio"] == "media"

            # Persist real 3-flavor order: base 15 + avg(40, 60, 50) = 15 + 50 = 65.00
            cmd = CreateOrderCommand(
                restaurant_id=TENANT_PIZZA,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(
                    OrderItemInput(
                        product_id="pizza-g",
                        quantity=1,
                        modifier_ids=(option_ids["Mussarela"], option_ids["Camarão"], option_ids["Quatro Queijos"]),
                    ),
                ),
                customer=CustomerInput(name="Cliente QA", phone="85999990001"),
                operator_user_id="admin-pizza-995",
                idempotency_key=f"pizza-test-{uuid.uuid4().hex}",
            )
            order = OrderApplicationService.create_order(db, cmd)
            assert order.total == Decimal("65.00")

            persisted_item = db.query(Item).filter_by(restaurante_id=TENANT_PIZZA, id=order.items[0].item_id).one()
            assert float(persisted_item.preco_unit) == 65.0
            persisted_mods = db.query(ItemModificador).filter_by(restaurante_id=TENANT_PIZZA, item_id=persisted_item.id).all()
            assert round(sum(float(m.preco_aplicado) for m in persisted_mods), 2) == 50.0
        finally:
            current_restaurante_id.reset(t)
    finally:
        db.close()


def test_kitchen_ticket_composition_presentation_renders_pizza_fractions():
    modifiers = [
        SelectedModifier("s1", "Calabresa", 42.0, grupo_id="g1", grupo_nome="Sabores", grupo_tipo="meio_a_meio"),
        SelectedModifier("s2", "Camarão", 68.0, grupo_id="g1", grupo_nome="Sabores", grupo_tipo="meio_a_meio"),
        SelectedModifier("b1", "Catupiry", 12.0, grupo_id="g2", grupo_nome="Borda", grupo_tipo="opcional"),
    ]
    lines, notes = composition_presentation(
        "Sem cebola - Opções: Calabresa, Camarão, Catupiry",
        modifiers,
        grouped=False,
    )
    assert lines == ("SABORES: 1/2 Calabresa, 1/2 Camarão", "BORDA: Catupiry")
    assert notes == "Sem cebola"
