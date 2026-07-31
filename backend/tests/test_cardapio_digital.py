import io
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.routes.auth import create_access_token
from app.models import Restaurante, Usuario

client = TestClient(app)

# Dummy 1x1 valid PNG image bytes
VALID_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?"
    b"\x03\x00\x05\x00\x01\x0d\x0a-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture(autouse=True)
def test_setup():
    from app.config import settings
    settings.SUPABASE_URL = "https://iiowhekvahxiepwcdidm.supabase.co"
    settings.SUPABASE_SERVICE_ROLE_KEY = "test_service_role_key_12345"
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(999)
    try:
        # Create test restaurant 999
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(
                id=999,
                nome="Restaurante Teste 999",
                plano="bistro",
                slug="sistema-gourmet-bistro",
            )
            db.add(rest)
            db.commit()
        elif rest.slug != "sistema-gourmet-bistro":
            rest.slug = "sistema-gourmet-bistro"
            db.commit()

        # Create test user for tenant 999
        user = db.query(Usuario).filter(Usuario.email == "test999@koma.com").first()
        if not user:
            user = Usuario(
                nome="Gerente Teste 999",
                email="test999@koma.com",
                cargo="admin",
                role="admin",
                status="ativo",
                restaurante_id=999
            )
            db.add(user)
        else:
            user.role = "admin"
            user.cargo = "admin"
            user.status = "ativo"
        db.commit()

        auth_token = create_access_token(subject=user.id, restaurante_id=999, role="admin")
        yield {"user": user, "token": auth_token, "rest_id": 999}
    finally:
        current_restaurante_id.set(None)
        db.close()


def test_upload_asset_unauthenticated():
    response = client.post("/api/cardapio-digital/assets/logo", files={"file": ("logo.png", VALID_PNG_BYTES, "image/png")})
    assert response.status_code == 401


def test_upload_asset_invalid_mime(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("script.sh", b"#!/bin/bash\necho hack", "text/plain")}
    )
    assert response.status_code == 400
    assert "Formato de arquivo inválido" in response.json()["detail"]


def test_upload_asset_exceeds_max_size(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    large_content = b"\x89PNG\r\n\x1a\n" + (b"0" * (5 * 1024 * 1024 + 10))
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("large.png", large_content, "image/png")}
    )
    assert response.status_code == 400
    assert "excede o limite máximo" in response.json()["detail"]


def test_upload_asset_rejects_spoofed_mime(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("fake.png", b"<script>alert(1)</script>", "image/png")},
    )

    assert response.status_code == 400
    assert "não corresponde ao formato" in response.json()["detail"]


@patch("httpx.AsyncClient.post")
def test_upload_logo_success(mock_post, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_post.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("logo.png", VALID_PNG_BYTES, "image/png")}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert "cardapio-assets/999/logo/" in data["logo_url"]


@patch("httpx.AsyncClient.post")
def test_upload_banner_success(mock_post, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_post.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/banner",
        headers=headers,
        files={"file": ("banner.png", VALID_PNG_BYTES, "image/png")}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert "cardapio-assets/999/banner/" in data["banner_url"]


@patch("httpx.AsyncClient.request")
def test_delete_logo_success(mock_delete, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_delete.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.delete("/api/cardapio-digital/assets/logo", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["logo_url"] is None


@patch("httpx.AsyncClient.request")
def test_delete_banner_success(mock_delete, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_delete.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.delete("/api/cardapio-digital/assets/banner", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["banner_url"] is None


@patch("httpx.AsyncClient.request")
def test_delete_asset_never_removes_object_from_another_tenant(
    mock_delete,
    test_setup,
):
    db = SessionLocal()
    try:
        restaurant = db.query(Restaurante).filter(
            Restaurante.id == test_setup["rest_id"]
        ).one()
        restaurant.logo_url = (
            "https://example.supabase.co/storage/v1/object/public/"
            "cardapio-assets/123/logo/foreign.png"
        )
        restaurant.cardapio_logo_path = None
        db.commit()
    finally:
        db.close()

    response = client.delete(
        "/api/cardapio-digital/assets/logo",
        headers={"Authorization": f"Bearer {test_setup['token']}"},
    )

    assert response.status_code == 200
    mock_delete.assert_not_awaited()
    assert response.json()["logo_url"] is None
    assert response.json()["cardapio_logo_path"] is None


def test_get_whitelabel_config_success(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.get("/api/cardapio-digital/config", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert "cor_primaria" in data
    assert "cor_fundo" in data


def test_update_whitelabel_config_success(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    payload = {
        "cor_primaria": "#123456",
        "cor_fundo": "#654321",
        "sobre_nos": "O melhor hambúrguer artesanal",
        "endereco": "Av. Paulista, 1000",
        "logo_url": "https://example.com/logo.png",
        "banner_url": "https://example.com/banner.png"
    }
    response = client.put("/api/cardapio-digital/config", headers=headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert data["cor_primaria"] == "#123456"
    assert data["cor_fundo"] == "#654321"
    assert data["sobre_nos"] == "O melhor hambúrguer artesanal"
    assert data["endereco"] == "Av. Paulista, 1000"
    assert data["logo_url"] == "https://example.com/logo.png"
    assert data["banner_url"] == "https://example.com/banner.png"


def test_get_caixa_config_cardapio_success(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.get("/caixa/config-cardapio", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999


def test_update_caixa_config_cardapio_success(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    payload = {
        "cor_primaria": "#ff0000",
        "cor_fundo": "#000000",
        "sobre_nos": "Sobre o Kôma",
        "endereco": "Rua 15 de Novembro, 100"
    }
    response = client.put("/caixa/config-cardapio", headers=headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
def test_get_whitelabel_config_by_slug_success(test_setup):
    response = client.get("/api/cardapio-digital/config?slug=sistema-gourmet-bistro")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert "cor_primaria" in data


def test_idempotency_order_deduplication(test_setup):
    """
    Test that sending an order with the same idempotency_key twice returns the same
    order without duplicating it in the database.
    """
    from app.models import Produto, Categoria
    db = SessionLocal()
    token_var = current_restaurante_id.set(999)
    try:
        cat = db.query(Categoria).filter(Categoria.id == "cat-idem-1").first()
        if not cat:
            cat = Categoria(id="cat-idem-1", restaurante_id=999, nome="Bebidas Idem")
            db.add(cat)
            db.commit()

        p = db.query(Produto).filter(Produto.id == "prod-idem-1").first()
        if not p:
            p = Produto(
                id="prod-idem-1",
                restaurante_id=999,
                categoria_id="cat-idem-1",
                nome="Suco Idempotente",
                preco=15.0,
                ativo=True
            )
            db.add(p)
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    order_payload = {
        "restaurante_id": 999,
        "itens": [
            {
                "produto_id": "prod-idem-1",
                "quantidade": 1,
                "observacao": "Sem açúcar",
                "cliente_nome": "Cliente Idempotente"
            }
        ],
        "cliente_nome": "Cliente Idempotente",
        "cliente_telefone": "11988887777",
        "endereco_entrega": "Rua Idempotente, 123",
        "taxa_entrega": 5.0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "delivery",
        "idempotency_key": "test-uuid-idempotency-key-12345"
    }

    # First request
    r1 = client.post("/cardapio/pedidos", json=order_payload)
    assert r1.status_code == 201
    d1 = r1.json()
    assert d1["status"] == "success"
    order_id = d1["comanda_id"]

    # Second request with identical idempotency_key
    r2 = client.post("/cardapio/pedidos", json=order_payload)
    assert r2.status_code in [200, 201]
    d2 = r2.json()
    assert d2.get("id") == order_id or d2.get("comanda_id") == order_id
    assert d2["mensagem"] == "Pedido já cadastrado com sucesso!"

    # Verify status query endpoint WITH correct key
    r_status = client.get(f"/cardapio/pedidos/{order_id}/status?key=test-uuid-idempotency-key-12345")
    assert r_status.status_code == 200
    st_data = r_status.json()
    assert st_data["id"] == order_id
    assert st_data["status"] == "pendente"
    # Security: ensure PII fields are NOT present in the response
    assert "cliente_nome" not in st_data
    assert "cliente_telefone" not in st_data
    assert "endereco_entrega" not in st_data
    assert "taxa_entrega" not in st_data


def test_status_endpoint_security_requires_idempotency_key():
    """
    A3 - Security test: the public status endpoint must require the
    correct idempotency_key to return data. Wrong/missing key must
    return 404, never revealing that the order exists.
    Cross-tenant isolation: order from tenant A must not be accessible
    with a key from tenant B.
    """
    from app.models import Restaurante, Categoria, Produto

    db = SessionLocal()

    # --- Setup Tenant 999 order ---
    token_var = current_restaurante_id.set(999)
    try:
        # Ensure category and product exist for tenant 999
        if not db.query(Categoria).filter(Categoria.id == "cat-sec-999").first():
            db.add(Categoria(id="cat-sec-999", nome="Cat Sec 999", restaurante_id=999))
            db.commit()
        if not db.query(Produto).filter(Produto.id == "prod-sec-999").first():
            db.add(Produto(
                id="prod-sec-999", restaurante_id=999,
                categoria_id="cat-sec-999", nome="Produto Sec 999",
                preco=10.0, ativo=True
            ))
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    # Create order on tenant 999
    order_a = {
        "restaurante_id": 999,
        "itens": [{"produto_id": "prod-sec-999", "quantidade": 1, "observacao": "", "cliente_nome": "Sec A"}],
        "cliente_nome": "Sec A",
        "cliente_telefone": "11999990001",
        "endereco_entrega": "Rua Sec A, 1",
        "taxa_entrega": 3.0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "delivery",
        "idempotency_key": "sec-key-tenant-999"
    }
    r1 = client.post("/cardapio/pedidos", json=order_a)
    assert r1.status_code == 201
    order_id_a = r1.json()["comanda_id"]

    # --- Test 1: No key → 404 ---
    r_no_key = client.get(f"/cardapio/pedidos/{order_id_a}/status")
    assert r_no_key.status_code == 404, "Missing key must return 404"

    # --- Test 2: Wrong key → 404 ---
    r_wrong = client.get(f"/cardapio/pedidos/{order_id_a}/status?key=wrong-key-abc")
    assert r_wrong.status_code == 404, "Wrong key must return 404"

    # --- Test 3: Correct key → 200 ---
    r_ok = client.get(f"/cardapio/pedidos/{order_id_a}/status?key=sec-key-tenant-999")
    assert r_ok.status_code == 200
    data = r_ok.json()
    assert data["id"] == order_id_a

    # --- Test 4: Non-existent comanda_id → 404 ---
    r_fake = client.get("/cardapio/pedidos/non-existent-id/status?key=sec-key-tenant-999")
    assert r_fake.status_code == 404

    # --- Test 5: Adjacent comanda_id with correct key of another order → 404 ---
    # Create a second order on same tenant to test ID guessing
    order_b = {
        "restaurante_id": 999,
        "itens": [{"produto_id": "prod-sec-999", "quantidade": 1, "observacao": "", "cliente_nome": "Sec B"}],
        "cliente_nome": "Sec B",
        "cliente_telefone": "11999990002",
        "endereco_entrega": "Rua Sec B, 2",
        "taxa_entrega": 3.0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "delivery",
        "idempotency_key": "sec-key-tenant-999-order-b"
    }
    r2 = client.post("/cardapio/pedidos", json=order_b)
    assert r2.status_code == 201
    order_id_b = r2.json()["comanda_id"]

    # Cross-order: order A's key on order B's ID → 404
    r_cross = client.get(f"/cardapio/pedidos/{order_id_b}/status?key=sec-key-tenant-999")
    assert r_cross.status_code == 404, "Key from order A must not unlock order B"

    # Cross-order reversed: order B's key on order A's ID → 404
    r_cross2 = client.get(f"/cardapio/pedidos/{order_id_a}/status?key=sec-key-tenant-999-order-b")
    assert r_cross2.status_code == 404, "Key from order B must not unlock order A"
