from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.application.orders.pricing_loader import PricingDataLoader, effective_product_price
from app.application.orders.validation_loader import ValidationDataLoader
from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import Categoria, ConfiguracaoRestaurante, Produto, Restaurante, Usuario
from app.routes import cardapio_popular
from app.routes.auth import create_access_token
from app.websocket_manager import manager

client = TestClient(app)

TENANT_ID = 987
ADMIN_USER_ID = "usr-admin-promo-987"
CATEGORY_ID = "cat-promo-987"


@pytest.fixture(autouse=True)
def setup_promo_tenant():
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).first()
        if not rest:
            rest = Restaurante(
                id=TENANT_ID,
                nome="Restaurante Vitrine 987",
                slug="rest-vitrine-987",
                plano="premium",
            )
            db.add(rest)
            db.flush()

        cfg = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == TENANT_ID
        ).first()
        if not cfg:
            cfg = ConfiguracaoRestaurante(restaurante_id=TENANT_ID)
            db.add(cfg)
            db.flush()

        user = db.query(Usuario).filter(Usuario.id == ADMIN_USER_ID).first()
        if not user:
            user = Usuario(
                id=ADMIN_USER_ID,
                restaurante_id=TENANT_ID,
                nome="Admin Vitrine",
                email="vitrine987@koma.com",
                cargo="admin",
                status="ativo",
            )
            db.add(user)
            db.flush()

        cat = db.query(Categoria).filter(
            Categoria.restaurante_id == TENANT_ID,
            Categoria.id == CATEGORY_ID,
        ).first()
        if not cat:
            cat = Categoria(
                id=CATEGORY_ID,
                restaurante_id=TENANT_ID,
                nome="Lanches Promo",
                destino_impressao="COZINHA",
            )
            db.add(cat)
            db.flush()

        db.query(Produto).filter(Produto.restaurante_id == TENANT_ID).delete()
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    cardapio_popular.invalidate_popular_products_cache(TENANT_ID)
    yield
    cardapio_popular.invalidate_popular_products_cache(TENANT_ID)


def _auth_headers():
    jwt_token = create_access_token(
        subject=ADMIN_USER_ID,
        restaurante_id=TENANT_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {jwt_token}"}


def test_crud_destaque_selo_and_preco_promocional():
    headers = _auth_headers()

    # Create with valid destaque, selo, preco_promocional
    create_res = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-vitrine-1",
            "nome": "Burger Especial",
            "categoria_id": CATEGORY_ID,
            "preco": 35.0,
            "destaque": True,
            "selo": "mais_vendido",
            "preco_promocional": 29.9,
        },
    )
    assert create_res.status_code == 201, create_res.text
    body = create_res.json()
    assert body["destaque"] is True
    assert body["selo"] == "mais_vendido"
    assert body["preco_promocional"] == pytest.approx(29.9)

    # Empty string selo normalizes to None
    empty_selo_res = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-vitrine-empty-selo",
            "nome": "Suco Natural",
            "categoria_id": CATEGORY_ID,
            "preco": 12.0,
            "selo": "   ",
        },
    )
    assert empty_selo_res.status_code == 201, empty_selo_res.text
    assert empty_selo_res.json()["selo"] is None
    assert empty_selo_res.json()["destaque"] is False
    assert empty_selo_res.json()["preco_promocional"] is None

    # Update isolated preco_promocional -> valid
    upd_ok = client.put(
        "/produtos/prod-vitrine-1",
        headers=headers,
        json={"preco_promocional": 25.0, "selo": "recomendado"},
    )
    assert upd_ok.status_code == 200, upd_ok.text
    assert upd_ok.json()["preco_promocional"] == pytest.approx(25.0)
    assert upd_ok.json()["selo"] == "recomendado"

    # Update isolated preco lower than existing preco_promocional -> 422
    upd_bad_preco = client.put(
        "/produtos/prod-vitrine-1",
        headers=headers,
        json={"preco": 25.0},
    )
    assert upd_bad_preco.status_code == 422

    # Update isolated preco_promocional >= existing preco -> 422
    upd_bad_promo = client.put(
        "/produtos/prod-vitrine-1",
        headers=headers,
        json={"preco_promocional": 35.0},
    )
    assert upd_bad_promo.status_code == 422

    # Clearing preco_promocional to None works
    clear_res = client.put(
        "/produtos/prod-vitrine-1",
        headers=headers,
        json={"preco_promocional": None, "destaque": False, "selo": ""},
    )
    assert clear_res.status_code == 200, clear_res.text
    assert clear_res.json()["preco_promocional"] is None
    assert clear_res.json()["destaque"] is False
    assert clear_res.json()["selo"] is None


@pytest.mark.parametrize(
    "payload_override",
    [
        {"selo": "invalido_badge"},
        {"preco_promocional": -1.0},
        {"preco_promocional": 30.0},  # equal to preco
        {"preco_promocional": 40.0},  # greater than preco
    ],
)
def test_product_create_rejects_invalid_selo_and_promo_price(payload_override):
    headers = _auth_headers()
    payload = {
        "id": "prod-invalid-case",
        "nome": "Item Invalido",
        "categoria_id": CATEGORY_ID,
        "preco": 30.0,
        **payload_override,
    }
    res = client.post("/produtos/", headers=headers, json=payload)
    assert res.status_code == 422, res.text


def test_fields_exposed_in_catalogo_public_menu_and_promocoes():
    headers = _auth_headers()
    res = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-public-1",
            "nome": "Pizza da Casa",
            "categoria_id": CATEGORY_ID,
            "preco": 50.0,
            "destaque": True,
            "selo": "edicao_limitada",
            "preco_promocional": 39.9,
        },
    )
    assert res.status_code == 201, res.text

    # GET /produtos/catalogo
    cat_res = client.get("/produtos/catalogo", headers=headers)
    assert cat_res.status_code == 200, cat_res.text
    cat_prod = next(p for p in cat_res.json()["produtos"] if p["id"] == "prod-public-1")
    assert cat_prod["destaque"] is True
    assert cat_prod["selo"] == "edicao_limitada"
    assert cat_prod["preco_promocional"] == pytest.approx(39.9)

    # GET /api/cardapio-digital/public
    pub_res = client.get(f"/api/cardapio-digital/public?restaurante_id={TENANT_ID}")
    assert pub_res.status_code == 200, pub_res.text
    pub_prod = next(p for p in pub_res.json()["produtos"] if p["id"] == "prod-public-1")
    assert pub_prod["destaque"] is True
    assert pub_prod["selo"] == "edicao_limitada"
    assert pub_prod["preco_promocional"] == pytest.approx(39.9)

    # GET /api/cardapio-digital/promocoes
    promos_res = client.get("/api/cardapio-digital/promocoes", headers=headers)
    assert promos_res.status_code == 200, promos_res.text
    admin_prod = next(p for p in promos_res.json()["produtos"] if p["id"] == "prod-public-1")
    assert admin_prod["destaque"] is True
    assert admin_prod["selo"] == "edicao_limitada"
    assert admin_prod["preco_promocional"] == pytest.approx(39.9)


def test_effective_product_price_and_order_loaders():
    assert effective_product_price(SimpleNamespace(preco=40.0, preco_promocional=29.5)) == Decimal("29.50")
    assert effective_product_price(SimpleNamespace(preco=40.0, preco_promocional=0.0)) == Decimal("0.00")
    assert effective_product_price(SimpleNamespace(preco=40.0, preco_promocional=None)) == Decimal("40.00")
    assert effective_product_price(SimpleNamespace(preco=40.0, preco_promocional=40.0)) == Decimal("40.00")
    assert effective_product_price(SimpleNamespace(preco=40.0, preco_promocional=55.0)) == Decimal("40.00")
    assert effective_product_price(SimpleNamespace(preco=40.0, preco_promocional=-5.0)) == Decimal("40.00")
    assert effective_product_price(None) == Decimal("0.00")

    headers = _auth_headers()
    res = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-pricing-1",
            "nome": "Combo Individual",
            "categoria_id": CATEGORY_ID,
            "preco": 45.0,
            "preco_promocional": 32.5,
        },
    )
    assert res.status_code == 201, res.text

    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        pricing_ctx = PricingDataLoader.build_pricing_context(
            db,
            restaurante_id=TENANT_ID,
            fulfillment="pickup",
            itens_solicitados=[{"produto_id": "prod-pricing-1", "quantidade": 2}],
        )
        assert pricing_ctx.items[0].base_price == Decimal("32.50")

        validation_ctx = ValidationDataLoader.build_validation_context(
            db,
            restaurante_id=TENANT_ID,
            fulfillment="pickup",
            itens_solicitados=[{"produto_id": "prod-pricing-1", "quantidade": 2}],
        )
        assert validation_ctx.catalog_products["prod-pricing-1"].price == Decimal("32.50")
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_popular_cache_invalidated_on_catalog_update():
    headers = _auth_headers()
    cardapio_popular._store_cache(TENANT_ID, [{"produto_id": "old", "escolhas": 9}])
    assert cardapio_popular._cached(TENANT_ID) == [{"produto_id": "old", "escolhas": 9}]

    res = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-cache-inv",
            "nome": "Produto Cache",
            "categoria_id": CATEGORY_ID,
            "preco": 20.0,
        },
    )
    assert res.status_code == 201, res.text
    assert cardapio_popular._cached(TENANT_ID) is None


def test_cupons_mutations_broadcast_config_updated(monkeypatch):
    headers = _auth_headers()
    broadcast_mock = AsyncMock()
    monkeypatch.setattr(manager, "broadcast", broadcast_mock)

    create_res = client.post(
        "/caixa/cupons",
        headers=headers,
        json={
            "codigo": "PROMOWS10",
            "tipo_desconto": "porcentagem",
            "valor_desconto": 10.0,
            "valor_minimo_pedido": 0.0,
            "ativo": True,
        },
    )
    assert create_res.status_code == 201, create_res.text
    cupom_id = create_res.json()["id"]
    assert any(
        call.args == ({"event": "config_updated"}, TENANT_ID)
        for call in broadcast_mock.await_args_list
    )

    broadcast_mock.reset_mock()
    update_res = client.put(
        f"/caixa/cupons/{cupom_id}",
        headers=headers,
        json={
            "codigo": "PROMOWS10",
            "tipo_desconto": "porcentagem",
            "valor_desconto": 15.0,
            "valor_minimo_pedido": 0.0,
            "ativo": True,
        },
    )
    assert update_res.status_code == 200, update_res.text
    assert any(
        call.args == ({"event": "config_updated"}, TENANT_ID)
        for call in broadcast_mock.await_args_list
    )

    broadcast_mock.reset_mock()
    del_res = client.delete(f"/caixa/cupons/{cupom_id}", headers=headers)
    assert del_res.status_code == 204, del_res.text
    assert any(
        call.args == ({"event": "config_updated"}, TENANT_ID)
        for call in broadcast_mock.await_args_list
    )
